/**
 * Hosted, read-only preflight for post-accept Base -> Solana settlement and
 * withdraw. This script verifies local proving artifacts, durable note-state,
 * Solana pending/FIFO state, and operator wallet authority before an operator
 * runs the mutating settle/withdraw verification script.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createHash } from "crypto";

export const MERKLE_BATCH_ZKEY_SHA256 =
  "107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9";
export const WITHDRAW_ZKEY_SHA256 =
  "cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0";

const DEFAULT_PROGRAM_ID = "DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD";
const DEFAULT_POOL_CONFIG = "DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF";
const DEFAULT_ARTIFACT_DIR = "/data/circuit-artifacts";
const DEFAULT_NOTE_STATE_DIR = "/data/white-bridge-note-state";
const DEFAULT_RESULT_DIR = "/data/bridge-results";

type JsonRecord = Record<string, any>;

export type ArtifactCheck = {
  path: string;
  exists: boolean;
  isSymlink: boolean;
  realPath: string | null;
  persistentCopyExists: boolean;
  underPersistentDir: boolean;
  sha256: string | null;
  expectedSha256?: string;
  hashMatches?: boolean;
};

export type ArtifactPreflight = {
  ok: boolean;
  artifactDir: string;
  merkleZkey: ArtifactCheck;
  withdrawZkey: ArtifactCheck;
  merkleWasm: { path: string; exists: boolean };
  withdrawWasm: { path: string; exists: boolean };
  errors: string[];
};

export type NoteStatePreflight = {
  ok: boolean;
  backupDir: string | null;
  statePath: string | null;
  checks: Record<string, boolean>;
  summary: {
    sourceBridgeOutHash: string | null;
    destinationBridgeMintHash: string | null;
    destinationCommitment: string | null;
    destinationAmount: string | null;
    assetId: string | null;
    hasDestSecret: boolean;
    hasDestNullifier: boolean;
  };
  errors: string[];
};

export type PendingFifoPreflight = {
  ok: boolean;
  checked: boolean;
  status: "ready" | "requires_fifo_prefix" | "already_settled" | "not_pending" | "unavailable";
  poolConfig: string | null;
  merkleTree: string | null;
  pendingBuffer: string | null;
  assetVault: string | null;
  commitmentIndex: string | null;
  consumedMessage: string | null;
  consumedPdaExists: boolean | null;
  targetPending: boolean | null;
  targetAlreadySettled: boolean | null;
  targetPendingIndex: number | null;
  pendingCount: number | null;
  fifoPrefixRequired: boolean | null;
  fifoPrefixCount: number | null;
  nextLeafIndex: number | null;
  currentMerkleRoot: string | null;
  errors: string[];
};

export type WalletPreflight = {
  ok: boolean;
  checked: boolean;
  present: string[];
  missing: string[];
  walletPublicKey: string | null;
  walletBalanceSol: number | null;
  expectedPoolAuthority: string | null;
  poolAuthorityMatches: boolean | null;
  errors: string[];
};

export type HostedSettleWithdrawPreflight = {
  ok: boolean;
  readiness:
    | "ready"
    | "blocked_artifacts"
    | "blocked_note_state"
    | "blocked_pending"
    | "blocked_wallet"
    | "blocked_fifo";
  generatedAt: string;
  route: string;
  sourceBridgeOutHash: string | null;
  destinationBridgeMintHash: string | null;
  destinationCommitment: string | null;
  artifacts: ArtifactPreflight;
  noteState: NoteStatePreflight;
  pending: PendingFifoPreflight;
  wallet: WalletPreflight;
  reportPath: string | null;
  transactionsSubmitted: false;
  secretsPrinted: false;
};

export function checkWalletAuthority(input: {
  walletPublicKey: string | null;
  expectedPoolAuthority: string | null;
  walletBalanceSol?: number | null;
}): Pick<WalletPreflight, "ok" | "poolAuthorityMatches" | "errors"> {
  const errors: string[] = [];
  const poolAuthorityMatches = Boolean(
    input.walletPublicKey && input.expectedPoolAuthority && input.walletPublicKey === input.expectedPoolAuthority
  );
  if (!input.walletPublicKey) errors.push("wallet_missing");
  if (!poolAuthorityMatches) errors.push("wallet_does_not_match_pool_authority");
  if (input.walletBalanceSol !== undefined && input.walletBalanceSol !== null && input.walletBalanceSol <= 0) {
    errors.push("wallet_balance_zero");
  }
  return { ok: errors.length === 0, poolAuthorityMatches, errors };
}

export function determineReadiness(input: {
  artifactsOk: boolean;
  noteStateOk: boolean;
  pendingOk: boolean;
  pendingStatus: PendingFifoPreflight["status"];
  walletOk: boolean;
}): HostedSettleWithdrawPreflight["readiness"] {
  if (!input.artifactsOk) return "blocked_artifacts";
  if (!input.noteStateOk) return "blocked_note_state";
  if (!input.pendingOk && input.pendingStatus === "requires_fifo_prefix") return "blocked_fifo";
  if (!input.pendingOk) return "blocked_pending";
  if (!input.walletOk) return "blocked_wallet";
  return "ready";
}

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, "../../..");
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isTmpPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const tmp = path.resolve(os.tmpdir());
  return resolved === tmp || resolved.startsWith(tmp + path.sep);
}

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeScalar(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return BigInt(value).toString();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed).toString();
  if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed).toString();
  return null;
}

function normalizeCommitment(value: unknown): string | null {
  if (typeof value !== "string") return normalizeScalar(value);
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return BigInt(trimmed).toString();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return BigInt(`0x${trimmed}`).toString();
  return normalizeScalar(trimmed);
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  return `0x${Buffer.from(bytes).toString("hex").padStart(64, "0")}`;
}

function hashFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function destinationFileName(destinationHash: string): string {
  return `${destinationHash.slice(2)}.bridge-note-state.json`;
}

function checkZkey(input: {
  path: string;
  persistentPath: string;
  artifactDir: string;
  expectedSha256: string;
}): ArtifactCheck {
  const exists = fs.existsSync(input.path);
  const lstat = exists ? fs.lstatSync(input.path) : null;
  const realPath = exists ? fs.realpathSync(input.path) : null;
  const sha256 = exists ? hashFile(input.path) : null;
  return {
    path: input.path,
    exists,
    isSymlink: Boolean(lstat?.isSymbolicLink()),
    realPath,
    persistentCopyExists: fs.existsSync(input.persistentPath),
    underPersistentDir: realPath ? isInside(realPath, input.artifactDir) : false,
    sha256,
    expectedSha256: input.expectedSha256,
    hashMatches: sha256 === input.expectedSha256,
  };
}

export function checkArtifacts(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): ArtifactPreflight {
  const root = repoRoot();
  const circuitBase = path.resolve(env.PR012G_CIRCUIT_BASE || path.join(root, "circuits"));
  const artifactDir = path.resolve(env.BRIDGE_CIRCUIT_ARTIFACT_DIR || DEFAULT_ARTIFACT_DIR);
  const expectedMerkleHash = env.PR012G_EXPECTED_MERKLE_ZKEY_SHA256 || MERKLE_BATCH_ZKEY_SHA256;
  const expectedWithdrawHash = env.PR012G_EXPECTED_WITHDRAW_ZKEY_SHA256 || WITHDRAW_ZKEY_SHA256;
  const merkleZkeyPath = path.join(circuitBase, "merkle_batch_update/build/merkle_batch_update.zkey");
  const withdrawZkeyPath = path.join(circuitBase, "withdraw/build/withdraw.zkey");
  const merkleWasmPath = path.join(
    circuitBase,
    "merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm"
  );
  const withdrawWasmPath = path.join(circuitBase, "withdraw/build/withdraw_js/withdraw.wasm");

  const merkleZkey = checkZkey({
    path: merkleZkeyPath,
    persistentPath: path.join(artifactDir, "merkle_batch_update/merkle_batch_update.zkey"),
    artifactDir,
    expectedSha256: expectedMerkleHash,
  });
  const withdrawZkey = checkZkey({
    path: withdrawZkeyPath,
    persistentPath: path.join(artifactDir, "withdraw/withdraw.zkey"),
    artifactDir,
    expectedSha256: expectedWithdrawHash,
  });
  const merkleWasm = { path: merkleWasmPath, exists: fs.existsSync(merkleWasmPath) };
  const withdrawWasm = { path: withdrawWasmPath, exists: fs.existsSync(withdrawWasmPath) };

  const errors: string[] = [];
  if (!merkleZkey.exists) errors.push("merkle_zkey_missing");
  if (!withdrawZkey.exists) errors.push("withdraw_zkey_missing");
  if (!merkleZkey.persistentCopyExists || !merkleZkey.underPersistentDir) errors.push("merkle_zkey_not_on_persistent_disk");
  if (!withdrawZkey.persistentCopyExists || !withdrawZkey.underPersistentDir) errors.push("withdraw_zkey_not_on_persistent_disk");
  if (!merkleZkey.hashMatches) errors.push("merkle_zkey_hash_mismatch");
  if (!withdrawZkey.hashMatches) errors.push("withdraw_zkey_hash_mismatch");
  if (!merkleWasm.exists) errors.push("merkle_wasm_missing");
  if (!withdrawWasm.exists) errors.push("withdraw_wasm_missing");

  return {
    ok: errors.length === 0,
    artifactDir,
    merkleZkey,
    withdrawZkey,
    merkleWasm,
    withdrawWasm,
    errors,
  };
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function summarizeNoteState(filePath: string | null): NoteStatePreflight["summary"] {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      sourceBridgeOutHash: null,
      destinationBridgeMintHash: null,
      destinationCommitment: null,
      destinationAmount: null,
      assetId: null,
      hasDestSecret: false,
      hasDestNullifier: false,
    };
  }
  const state = readJson(filePath);
  const sourceMessage = state.sourceMessage || state.message || {};
  const bridgeMintMessage = state.bridgeMintMessage || {};
  return {
    sourceBridgeOutHash:
      normalizeHash(state.sourceMessageHash) ||
      normalizeHash(state.sourceBridgeOutHash) ||
      normalizeHash(state.messageHash),
    destinationBridgeMintHash:
      normalizeHash(state.bridgeMintMessageHash) ||
      normalizeHash(state.destinationBridgeMintHash) ||
      normalizeHash(state.destinationMessageHash),
    destinationCommitment:
      normalizeCommitment(state.destinationCommitment) ||
      normalizeCommitment(state.destCommitment) ||
      normalizeCommitment(bridgeMintMessage.destinationCommitment) ||
      normalizeCommitment(sourceMessage.destinationCommitment),
    destinationAmount: normalizeScalar(state.destinationAmount) || normalizeScalar(state.destAmount) || normalizeScalar(state.amount),
    assetId:
      normalizeCommitment(state.solanaAssetId) ||
      normalizeCommitment(bridgeMintMessage.destinationLocalAssetId) ||
      normalizeCommitment(sourceMessage.destinationLocalAssetId),
    hasDestSecret: state.destSecret !== undefined && state.destSecret !== null && state.destSecret !== "",
    hasDestNullifier: state.destNullifier !== undefined && state.destNullifier !== null && state.destNullifier !== "",
  };
}

export function checkNoteState(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): NoteStatePreflight {
  const root = repoRoot();
  const backupDir = env.BRIDGE_NOTE_STATE_BACKUP_DIR ? path.resolve(env.BRIDGE_NOTE_STATE_BACKUP_DIR) : null;
  const expectedSource = normalizeHash(env.BRIDGE_NOTE_EXPECTED_SOURCE_HASH || env.PR012B_SOURCE_MESSAGE_HASH);
  const expectedDestination = normalizeHash(
    env.BRIDGE_NOTE_EXPECTED_DESTINATION_HASH ||
      env.BRIDGE_NOTE_STATE_EXPECTED_DESTINATION_HASH ||
      env.PR012B_DESTINATION_MESSAGE_HASH
  );
  const expectedCommitment = normalizeCommitment(env.BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT);
  const expectedAmount = normalizeScalar(env.BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT);
  const expectedAsset = normalizeCommitment(env.BRIDGE_NOTE_EXPECTED_ASSET_ID);
  const allowTmpNoteState = env.BRIDGE_ALLOW_TMP_NOTE_STATE === "true";
  const statePath = env.BRIDGE_NOTE_STATE_INPUT
    ? path.resolve(env.BRIDGE_NOTE_STATE_INPUT)
    : backupDir && expectedDestination
      ? path.join(backupDir, destinationFileName(expectedDestination))
      : null;
  const summary = summarizeNoteState(statePath);
  const checks: Record<string, boolean> = {
    backupDirSet: Boolean(backupDir),
    backupDirExists: Boolean(backupDir && fs.existsSync(backupDir)),
    backupDirNotTmp: Boolean(backupDir && (!isTmpPath(backupDir) || allowTmpNoteState)),
    backupDirOutsideRepo: Boolean(backupDir && !isInside(backupDir, root)),
    stateFileExists: Boolean(statePath && fs.existsSync(statePath)),
    sourceHash: expectedSource ? summary.sourceBridgeOutHash === expectedSource : true,
    destinationHash: expectedDestination ? summary.destinationBridgeMintHash === expectedDestination : false,
    destinationCommitment: expectedCommitment ? summary.destinationCommitment === expectedCommitment : true,
    amount: expectedAmount ? summary.destinationAmount === expectedAmount : true,
    asset: expectedAsset ? summary.assetId === expectedAsset : true,
    hasDestSecret: summary.hasDestSecret,
    hasDestNullifier: summary.hasDestNullifier,
  };
  const errors = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([name]) => `note_state_${name}_failed`);
  return {
    ok: errors.length === 0,
    backupDir,
    statePath,
    checks,
    summary,
    errors,
  };
}

function pendingCount(pendingData: any): number {
  if (pendingData?.totalPending !== undefined) return Number(pendingData.totalPending);
  return pendingData?.deposits?.length || 0;
}

export function planFifoFromPending(input: {
  pendingData: any;
  targetCommitmentHex: string;
  commitmentIndexExists?: boolean;
  nextLeafIndex?: number;
  currentMerkleRoot?: string;
}): Pick<
  PendingFifoPreflight,
  | "status"
  | "ok"
  | "targetPending"
  | "targetAlreadySettled"
  | "targetPendingIndex"
  | "pendingCount"
  | "fifoPrefixRequired"
  | "fifoPrefixCount"
  | "nextLeafIndex"
  | "currentMerkleRoot"
> {
  const targetBytes = Buffer.from(input.targetCommitmentHex.replace(/^0x/, ""), "hex");
  const deposits = input.pendingData?.deposits || [];
  const index = deposits.findIndex((deposit: any) => Buffer.from(deposit.commitment).equals(targetBytes));
  const count = pendingCount(input.pendingData);
  if (index >= 0) {
    return {
      ok: index === 0,
      status: index === 0 ? "ready" : "requires_fifo_prefix",
      targetPending: true,
      targetAlreadySettled: false,
      targetPendingIndex: index,
      pendingCount: count,
      fifoPrefixRequired: index > 0,
      fifoPrefixCount: index,
      nextLeafIndex: input.nextLeafIndex ?? null,
      currentMerkleRoot: input.currentMerkleRoot ?? null,
    };
  }
  return {
    ok: Boolean(input.commitmentIndexExists),
    status: input.commitmentIndexExists ? "already_settled" : "not_pending",
    targetPending: false,
    targetAlreadySettled: Boolean(input.commitmentIndexExists),
    targetPendingIndex: null,
    pendingCount: count,
    fifoPrefixRequired: null,
    fifoPrefixCount: null,
    nextLeafIndex: input.nextLeafIndex ?? null,
    currentMerkleRoot: input.currentMerkleRoot ?? null,
  };
}

function loadKeypairFromJson(raw: string): Keypair {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error("keypair_must_be_json_array_64_numbers");
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

function loadWalletPublicKey(env: NodeJS.ProcessEnv | Record<string, string | undefined>): string | null {
  if (env.ANCHOR_WALLET && fs.existsSync(env.ANCHOR_WALLET)) {
    return loadKeypairFromJson(fs.readFileSync(env.ANCHOR_WALLET, "utf8")).publicKey.toBase58();
  }
  if (env.SOLANA_POOL_AUTHORITY_KEYPAIR) {
    return loadKeypairFromJson(env.SOLANA_POOL_AUTHORITY_KEYPAIR).publicKey.toBase58();
  }
  if (env.RELAYER_KEYPAIR) {
    return loadKeypairFromJson(env.RELAYER_KEYPAIR).publicKey.toBase58();
  }
  return null;
}

export async function runPreflight(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): Promise<HostedSettleWithdrawPreflight> {
  const root = repoRoot();
  const generatedAt = new Date().toISOString();
  const sourceBridgeOutHash = normalizeHash(env.PR012B_SOURCE_MESSAGE_HASH || env.BRIDGE_NOTE_EXPECTED_SOURCE_HASH);
  const destinationBridgeMintHash = normalizeHash(
    env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_NOTE_EXPECTED_DESTINATION_HASH
  );
  const artifacts = checkArtifacts(env);
  const noteState = checkNoteState(env);
  const destinationCommitmentDecimal = noteState.summary.destinationCommitment;
  const destinationCommitmentHex = env.BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT || (
    destinationCommitmentDecimal
      ? `0x${BigInt(destinationCommitmentDecimal).toString(16).padStart(64, "0")}`
      : null
  );

  const walletPresentNames = [
    "ANCHOR_WALLET",
    "SOLANA_POOL_AUTHORITY_KEYPAIR",
    "SOLANA_DEVNET_RPC_URL",
    "RPC_ENDPOINT",
    "IDL_PATH",
    "PROGRAM_ID",
    "POOL_CONFIG",
  ].filter((name) => Boolean(env[name]));
  const walletMissingNames = ["ANCHOR_WALLET", "SOLANA_POOL_AUTHORITY_KEYPAIR", "PROGRAM_ID", "POOL_CONFIG"].filter(
    (name) => !env[name]
  );
  const walletPublicKey = loadWalletPublicKey(env);
  const wallet: WalletPreflight = {
    ok: false,
    checked: false,
    present: walletPresentNames,
    missing: walletMissingNames,
    walletPublicKey,
    walletBalanceSol: null,
    expectedPoolAuthority: null,
    poolAuthorityMatches: null,
    errors: [],
  };
  const pending: PendingFifoPreflight = {
    ok: false,
    checked: false,
    status: "unavailable",
    poolConfig: null,
    merkleTree: null,
    pendingBuffer: null,
    assetVault: null,
    commitmentIndex: null,
    consumedMessage: null,
    consumedPdaExists: null,
    targetPending: null,
    targetAlreadySettled: null,
    targetPendingIndex: null,
    pendingCount: null,
    fifoPrefixRequired: null,
    fifoPrefixCount: null,
    nextLeafIndex: null,
    currentMerkleRoot: null,
    errors: [],
  };

  if (!destinationCommitmentHex || !destinationBridgeMintHash) {
    pending.errors.push("target_destination_hash_or_commitment_missing");
  } else if (env.PR012G_SKIP_RPC !== "true") {
    try {
      const rpcUrl = env.ANCHOR_PROVIDER_URL || env.SOLANA_DEVNET_RPC_URL || env.RPC_ENDPOINT || "https://api.devnet.solana.com";
      const connection = new Connection(rpcUrl, "confirmed");
      const idlPath = env.IDL_PATH || path.join(root, "chains/solana/sdk/src/idl/white_protocol.json");
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      const programId = new PublicKey(env.PROGRAM_ID || idl.address || DEFAULT_PROGRAM_ID);
      const poolConfig = new PublicKey(env.POOL_CONFIG || DEFAULT_POOL_CONFIG);
      const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" });
      (idl as any).address = programId.toBase58();
      const program = new anchor.Program(idl as any, provider);
      const [merkleTree] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree"), poolConfig.toBuffer()], programId);
      const [pendingBuffer] = PublicKey.findProgramAddressSync([Buffer.from("pending"), poolConfig.toBuffer()], programId);
      const [commitmentIndex] = PublicKey.findProgramAddressSync(
        [Buffer.from("commitment"), poolConfig.toBuffer(), Buffer.from(destinationCommitmentHex.slice(2), "hex")],
        programId
      );
      const assetIdHex = noteState.summary.assetId ? BigInt(noteState.summary.assetId).toString(16).padStart(64, "0") : null;
      const [assetVault] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault"), poolConfig.toBuffer(), Buffer.from(assetIdHex || "00".repeat(32), "hex")],
        programId
      );
      const [consumedMessage] = PublicKey.findProgramAddressSync(
        [Buffer.from("bridge_consumed"), Buffer.from(destinationBridgeMintHash.slice(2), "hex")],
        programId
      );
      const poolData = await (program.account as any).poolConfig.fetch(poolConfig);
      const merkleData = await (program.account as any).merkleTree.fetch(merkleTree);
      const pendingData = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
      const commitmentIndexInfo = await connection.getAccountInfo(commitmentIndex, "confirmed");
      const consumedInfo = await connection.getAccountInfo(consumedMessage, "confirmed");
      const assetVaultInfo = await connection.getAccountInfo(assetVault, "confirmed");
      const balanceLamports = walletPublicKey ? await connection.getBalance(new PublicKey(walletPublicKey), "confirmed") : null;

      const fifo = planFifoFromPending({
        pendingData,
        targetCommitmentHex: destinationCommitmentHex,
        commitmentIndexExists: Boolean(commitmentIndexInfo),
        nextLeafIndex: Number(merkleData.nextLeafIndex),
        currentMerkleRoot: bytesToHex(merkleData.currentRoot),
      });

      Object.assign(pending, {
        ...fifo,
        checked: true,
        poolConfig: poolConfig.toBase58(),
        merkleTree: merkleTree.toBase58(),
        pendingBuffer: pendingBuffer.toBase58(),
        assetVault: assetVault.toBase58(),
        commitmentIndex: commitmentIndex.toBase58(),
        consumedMessage: consumedMessage.toBase58(),
        consumedPdaExists: Boolean(consumedInfo),
      });
      if (!assetVaultInfo) pending.errors.push("asset_vault_missing");
      if (!consumedInfo) pending.errors.push("consumed_message_missing");
      pending.ok = pending.errors.length === 0 && fifo.ok;

      wallet.checked = true;
      wallet.walletBalanceSol = balanceLamports === null ? null : balanceLamports / 1_000_000_000;
      wallet.expectedPoolAuthority = poolData.authority.toBase58();
      const walletPolicy = checkWalletAuthority({
        walletPublicKey,
        expectedPoolAuthority: wallet.expectedPoolAuthority,
        walletBalanceSol: wallet.walletBalanceSol,
      });
      wallet.poolAuthorityMatches = walletPolicy.poolAuthorityMatches;
      wallet.errors.push(...walletPolicy.errors);
      wallet.ok = walletPolicy.ok;
    } catch (err) {
      pending.errors.push(err instanceof Error ? err.message : String(err));
      wallet.errors.push("rpc_wallet_check_unavailable");
    }
  } else {
    pending.checked = false;
    wallet.checked = false;
  }

  const readiness = determineReadiness({
    artifactsOk: artifacts.ok,
    noteStateOk: noteState.ok,
    pendingOk: pending.ok,
    pendingStatus: pending.status,
    walletOk: wallet.ok,
  });

  return {
    ok: readiness === "ready",
    readiness,
    generatedAt,
    route: "base-sepolia->solana-devnet",
    sourceBridgeOutHash,
    destinationBridgeMintHash,
    destinationCommitment: destinationCommitmentHex,
    artifacts,
    noteState,
    pending,
    wallet,
    reportPath: null,
    transactionsSubmitted: false,
    secretsPrinted: false,
  };
}

function ensureNoSecretsRendered(report: HostedSettleWithdrawPreflight): void {
  const rendered = JSON.stringify(report);
  for (const sentinel of ["privateKey", "mnemonic", "seedPhrase", "super-secret-sentinel", "super-nullifier-sentinel"]) {
    if (rendered.includes(sentinel)) {
      throw new Error(`preflight_report_contains_sensitive_field:${sentinel}`);
    }
  }
}

async function main(): Promise<void> {
  const report = await runPreflight(process.env);
  ensureNoSecretsRendered(report);
  const destination = report.destinationBridgeMintHash || "unknown";
  const resultDir = path.resolve(process.env.PR012G_PREFLIGHT_RESULT_DIR || DEFAULT_RESULT_DIR);
  fs.mkdirSync(resultDir, { recursive: true, mode: 0o700 });
  const resultPath = path.join(resultDir, `preflight-${destination.replace(/^0x/, "")}.json`);
  const finalReport = { ...report, reportPath: resultPath };
  fs.writeFileSync(resultPath, JSON.stringify(finalReport, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(finalReport, null, 2));
  process.exit(finalReport.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
