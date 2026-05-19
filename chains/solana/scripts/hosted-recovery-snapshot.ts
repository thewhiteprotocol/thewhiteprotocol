/**
 * Read-only hosted recovery snapshot for Base -> Solana settlement/withdraw.
 *
 * This command only reads Solana/account/report state. It does not submit
 * transactions, generate proofs, settle, or withdraw.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import {
  checkNoteState,
  planFifoFromPending,
  type HostedSettleWithdrawPreflight,
  type PendingFifoPreflight,
} from "./hosted-settle-withdraw-preflight";
import { jobIndexPathFor, type OperatorJobEntry, type OperatorJobIndex } from "./hosted-settle-withdraw-job";
import {
  readLeafIndexEvidence,
  type LeafIndexEvidence,
} from "./hosted-leaf-index-evidence";
import {
  deriveSpentNullifierPdaFromNoteState,
  type SpentNullifierDerivation,
} from "./hosted-spent-nullifier";

const DEFAULT_PROGRAM_ID = "DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD";
const DEFAULT_POOL_CONFIG = "DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF";
const DEFAULT_RESULT_DIR = "/data/bridge-results";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

type AccountSnapshot = {
  address: string;
  exists: boolean;
  owner: string | null;
  expectedOwnerMatch: boolean | null;
};

type TxSnapshot = {
  provided: boolean;
  signature: string | null;
  found: boolean | null;
  confirmationStatus: string | null;
  slot: number | null;
  err: unknown;
  blockTime: number | null;
  logsPreview: string[];
};

type Reader = {
  getSignature(signature: string): Promise<TxSnapshot>;
  getAccount(address: PublicKey, expectedOwner?: PublicKey): Promise<AccountSnapshot>;
  fetchPoolConfig(poolConfig: PublicKey): Promise<any>;
  fetchMerkleTree(merkleTree: PublicKey): Promise<any>;
  fetchPendingBuffer(pendingBuffer: PublicKey): Promise<any>;
};

export type RecoverySnapshotReadiness =
  | "ready_for_resume"
  | "blocked_note_state_invalid"
  | "blocked_note_state_missing"
  | "blocked_spent_nullifier_unknown"
  | "blocked_preflight_missing"
  | "blocked_preflight_stale"
  | "blocked_destination_hash_mismatch"
  | "blocked_pending_not_found"
  | "blocked_ambiguous_state"
  | "already_settled_pending_missing"
  | "already_withdrawn_spent_nullifier"
  | "tx_failed"
  | "tx_unknown";

export type RecoverySnapshotRecommendedAction =
  | "run_preflight"
  | "restore_note_state"
  | "settle_fifo_prefix"
  | "resume_settlement"
  | "resume_withdraw"
  | "no_action_already_complete"
  | "operator_review_required";

export type HostedRecoverySnapshot = {
  ok: boolean;
  generatedAt: string;
  route: "base-sepolia->solana-devnet";
  destinationMessageHash: string | null;
  sourceMessageHash: string | null;
  submitTx: TxSnapshot;
  programId: string | null;
  poolConfig: string | null;
  noteState: ReturnType<typeof checkNoteState> & { present: boolean };
  preflight: {
    present: boolean;
    path: string | null;
    sha256: string | null;
    readiness: string | null;
    ageSeconds: number | null;
    destinationHashMatches: boolean | null;
  };
  jobIndex: {
    present: boolean;
    path: string;
    latestPhase: string | null;
    latestJobId: string | null;
    settlementTx: string | null;
    withdrawTx: string | null;
    duplicateExecutionWouldBlock: boolean;
    resultReportPath: string | null;
    spentNullifier: string | null;
  };
  leafIndexEvidence: {
    found: boolean;
    path: string | null;
    sha256: string | null;
    source: string | null;
    leafIndex: number | null;
    errors: string[];
  };
  spentNullifier: SpentNullifierDerivation & {
    exists: boolean | null;
    checkedAt: string | null;
    withdrawAlreadyConsumed: boolean;
  };
  pdas: {
    consumedMessage: AccountSnapshot | null;
    frozenMessage: AccountSnapshot | null;
    commitmentIndex: AccountSnapshot | null;
    pendingBuffer: AccountSnapshot | null;
    poolConfig: AccountSnapshot | null;
    merkleTree: AccountSnapshot | null;
    assetVault: AccountSnapshot | null;
    spentNullifier: AccountSnapshot | null;
  };
  pending: Pick<
    PendingFifoPreflight,
    | "checked"
    | "status"
    | "targetPending"
    | "targetAlreadySettled"
    | "targetPendingIndex"
    | "pendingCount"
    | "fifoPrefixRequired"
    | "fifoPrefixCount"
    | "nextLeafIndex"
    | "currentMerkleRoot"
    | "errors"
  >;
  readiness: RecoverySnapshotReadiness;
  recommendedAction: RecoverySnapshotRecommendedAction;
  reportPath: string | null;
  transactionsSubmitted: false;
  proofsGenerated: false;
  secretsPrinted: false;
};

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function repoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, "../../..");
}

function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function bytesToHex(bytes: Uint8Array | number[]): string {
  return `0x${Buffer.from(bytes).toString("hex").padStart(64, "0")}`;
}

function commitmentHexFromNoteState(noteState: ReturnType<typeof checkNoteState>): string | null {
  const decimal = noteState.summary.destinationCommitment;
  if (!decimal) return null;
  return `0x${BigInt(decimal).toString(16).padStart(64, "0")}`;
}

function assetIdBytesFromNoteState(noteState: ReturnType<typeof checkNoteState>): Buffer {
  const assetId = noteState.summary.assetId;
  return Buffer.from(assetId ? BigInt(assetId).toString(16).padStart(64, "0") : "00".repeat(32), "hex");
}

function safeCheckNoteState(env: Env): ReturnType<typeof checkNoteState> {
  try {
    return checkNoteState(env);
  } catch {
    return {
      ok: false,
      backupDir: env.BRIDGE_NOTE_STATE_BACKUP_DIR || null,
      statePath: env.BRIDGE_NOTE_STATE_INPUT || null,
      checks: {
        backupDirSet: Boolean(env.BRIDGE_NOTE_STATE_BACKUP_DIR),
        backupDirExists: true,
        backupDirNotTmp: true,
        backupDirOutsideRepo: true,
        stateFileExists: Boolean(env.BRIDGE_NOTE_STATE_INPUT),
        sourceHash: false,
        destinationHash: false,
        destinationCommitment: false,
        amount: false,
        asset: false,
        hasDestSecret: false,
        hasDestNullifier: false,
      },
      summary: {
        sourceBridgeOutHash: null,
        destinationBridgeMintHash: null,
        destinationCommitment: null,
        destinationAmount: null,
        assetId: null,
        hasDestSecret: false,
        hasDestNullifier: false,
      },
      errors: ["note_state_parse_failed"],
    };
  }
}

function resultDir(env: Env): string {
  return path.resolve(env.BRIDGE_RESULTS_DIR || env.PR012G_PREFLIGHT_RESULT_DIR || DEFAULT_RESULT_DIR);
}

function defaultReportPath(destinationHash: string, env: Env): string {
  return path.join(resultDir(env), `recovery-snapshot-${destinationHash.slice(2)}.json`);
}

function defaultPreflightPath(destinationHash: string, env: Env): string {
  if (env.BRIDGE_PREFLIGHT_REPORT_PATH) return path.resolve(env.BRIDGE_PREFLIGHT_REPORT_PATH);
  return path.join(resultDir(env), `preflight-${destinationHash.slice(2)}.json`);
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function leafIndexFromNoteStatePath(noteStatePath: string | null | undefined): number | null {
  let state: any = null;
  try {
    state = readJson<any>(noteStatePath || "");
  } catch {
    return null;
  }
  const value = state?.leafIndex ?? state?.destinationLeafIndex ?? state?.destLeafIndex;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  return null;
}

function latestJobForDestination(indexPath: string, destinationHash: string): OperatorJobEntry | null {
  const index = readJson<OperatorJobIndex>(indexPath);
  if (!index?.jobs) return null;
  return (
    [...index.jobs]
      .reverse()
      .find((job) => job.destinationMessageHash?.toLowerCase() === destinationHash.toLowerCase()) || null
  );
}

function spentNullifierFromResult(job: OperatorJobEntry | null): string | null {
  if (!job?.resultReportPath) return null;
  const result = readJson<any>(job.resultReportPath);
  const value = result?.verifyResult?.evidence?.spentNullifier || result?.evidence?.spentNullifier;
  return typeof value === "string" ? value : null;
}

function leafIndexFromResult(job: OperatorJobEntry | null): number | null {
  if (!job?.resultReportPath) return null;
  const result = readJson<any>(job.resultReportPath);
  const value =
    result?.verifyResult?.evidence?.nextLeafIndexBefore ??
    result?.evidence?.nextLeafIndexBefore;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return Number(value);
  return null;
}

function emptyTx(signature: string | null): TxSnapshot {
  return {
    provided: Boolean(signature),
    signature,
    found: null,
    confirmationStatus: null,
    slot: null,
    err: null,
    blockTime: null,
    logsPreview: [],
  };
}

function pendingUnavailable(error: string): HostedRecoverySnapshot["pending"] {
  return {
    checked: false,
    status: "unavailable",
    targetPending: null,
    targetAlreadySettled: null,
    targetPendingIndex: null,
    pendingCount: null,
    fifoPrefixRequired: null,
    fifoPrefixCount: null,
    nextLeafIndex: null,
    currentMerkleRoot: null,
    errors: [error],
  };
}

function noteStateReadyForSnapshot(noteState: ReturnType<typeof checkNoteState> & { present?: boolean }): boolean {
  return Boolean(
    noteState.present ||
    (
      noteState.checks.stateFileExists &&
      noteState.checks.sourceHash &&
      noteState.checks.destinationHash &&
      noteState.checks.destinationCommitment &&
      noteState.checks.amount &&
      noteState.checks.asset &&
      noteState.summary.hasDestSecret &&
      noteState.summary.hasDestNullifier
    )
  );
}

function derivePdas(input: {
  destinationHash: string;
  destinationCommitmentHex: string | null;
  assetIdBytes: Buffer;
  poolConfig: PublicKey;
  programId: PublicKey;
  spentNullifier: string | null;
}): {
  consumedMessage: PublicKey;
  frozenMessage: PublicKey;
  commitmentIndex: PublicKey | null;
  pendingBuffer: PublicKey;
  merkleTree: PublicKey;
  assetVault: PublicKey;
  spentNullifier: PublicKey | null;
} {
  const hashBytes = Buffer.from(input.destinationHash.slice(2), "hex");
  const [consumedMessage] = PublicKey.findProgramAddressSync([Buffer.from("bridge_consumed"), hashBytes], input.programId);
  const [frozenMessage] = PublicKey.findProgramAddressSync([Buffer.from("bridge_frozen"), hashBytes], input.programId);
  const [pendingBuffer] = PublicKey.findProgramAddressSync([Buffer.from("pending"), input.poolConfig.toBuffer()], input.programId);
  const [merkleTree] = PublicKey.findProgramAddressSync([Buffer.from("merkle_tree"), input.poolConfig.toBuffer()], input.programId);
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), input.poolConfig.toBuffer(), input.assetIdBytes],
    input.programId
  );
  const [commitmentIndex] = input.destinationCommitmentHex
    ? PublicKey.findProgramAddressSync(
        [Buffer.from("commitment"), input.poolConfig.toBuffer(), Buffer.from(input.destinationCommitmentHex.slice(2), "hex")],
        input.programId
      )
    : [null];
  return {
    consumedMessage,
    frozenMessage,
    commitmentIndex,
    pendingBuffer,
    merkleTree,
    assetVault,
    spentNullifier: input.spentNullifier ? new PublicKey(input.spentNullifier) : null,
  };
}

async function defaultReader(env: Env, programId: PublicKey): Promise<Reader> {
  const root = repoRoot();
  const rpc = env.ANCHOR_PROVIDER_URL || env.SOLANA_DEVNET_RPC_URL || env.RPC_ENDPOINT || "https://api.devnet.solana.com";
  const connection = new Connection(rpc, "confirmed");
  const idlPath = env.IDL_PATH || path.join(root, "chains/solana/sdk/src/idl/white_protocol.json");
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  (idl as any).address = programId.toBase58();
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" });
  const program = new anchor.Program(idl as any, provider);
  return {
    async getSignature(signature: string): Promise<TxSnapshot> {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      const tx = await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      return {
        provided: true,
        signature,
        found: Boolean(status || tx),
        confirmationStatus: status?.confirmationStatus || null,
        slot: status?.slot || tx?.slot || null,
        err: status?.err || tx?.meta?.err || null,
        blockTime: tx?.blockTime || null,
        logsPreview: (tx?.meta?.logMessages || []).slice(0, 12),
      };
    },
    async getAccount(address: PublicKey, expectedOwner?: PublicKey): Promise<AccountSnapshot> {
      const info = await connection.getAccountInfo(address, "confirmed");
      return {
        address: address.toBase58(),
        exists: Boolean(info),
        owner: info?.owner.toBase58() || null,
        expectedOwnerMatch: info && expectedOwner ? info.owner.equals(expectedOwner) : info ? null : false,
      };
    },
    async fetchPoolConfig(poolConfig: PublicKey): Promise<any> {
      return (program.account as any).poolConfig.fetch(poolConfig);
    },
    async fetchMerkleTree(merkleTree: PublicKey): Promise<any> {
      return (program.account as any).merkleTree.fetch(merkleTree);
    },
    async fetchPendingBuffer(pendingBuffer: PublicKey): Promise<any> {
      return (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
    },
  };
}

function classify(input: {
  tx: TxSnapshot;
  notePresent: boolean;
  noteOk: boolean;
  spentNullifierDerivation: SpentNullifierDerivation;
  spentNullifierRpcError: boolean;
  preflightPresent: boolean;
  preflightAgeSeconds: number | null;
  preflightHashMatches: boolean | null;
  pending: HostedRecoverySnapshot["pending"];
  spentNullifierExists: boolean | null;
  latestJob: OperatorJobEntry | null;
}): { readiness: RecoverySnapshotReadiness; recommendedAction: RecoverySnapshotRecommendedAction } {
  if (input.tx.err) return { readiness: "tx_failed", recommendedAction: "operator_review_required" };
  if (input.tx.provided && input.tx.found === false) return { readiness: "tx_unknown", recommendedAction: "operator_review_required" };
  if (!input.notePresent || !input.noteOk) return { readiness: "blocked_note_state_missing", recommendedAction: "restore_note_state" };
  if (input.pending.status === "not_pending") {
    return { readiness: "blocked_pending_not_found", recommendedAction: "operator_review_required" };
  }
  if (!input.spentNullifierDerivation.derived) {
    const readiness = input.spentNullifierDerivation.error === "leaf_index_missing"
      ? "blocked_spent_nullifier_unknown"
      : "blocked_note_state_invalid";
    return { readiness, recommendedAction: "operator_review_required" };
  }
  if (input.spentNullifierRpcError) {
    return { readiness: "blocked_spent_nullifier_unknown", recommendedAction: "operator_review_required" };
  }
  if (!input.preflightPresent) return { readiness: "blocked_preflight_missing", recommendedAction: "run_preflight" };
  if (input.preflightAgeSeconds !== null && input.preflightAgeSeconds > 15 * 60) {
    return { readiness: "blocked_preflight_stale", recommendedAction: "run_preflight" };
  }
  if (input.preflightHashMatches === false) {
    return { readiness: "blocked_destination_hash_mismatch", recommendedAction: "operator_review_required" };
  }
  if (input.spentNullifierExists) {
    return { readiness: "already_withdrawn_spent_nullifier", recommendedAction: "no_action_already_complete" };
  }
  if (input.pending.status === "requires_fifo_prefix") {
    return { readiness: "ready_for_resume", recommendedAction: "settle_fifo_prefix" };
  }
  if (input.pending.status === "not_pending") {
    return { readiness: "blocked_pending_not_found", recommendedAction: "operator_review_required" };
  }
  if (input.pending.status === "already_settled") {
    return { readiness: "already_settled_pending_missing", recommendedAction: "resume_withdraw" };
  }
  if (input.latestJob?.status === "settlement_confirmed") {
    return { readiness: "ready_for_resume", recommendedAction: "resume_withdraw" };
  }
  if (input.pending.status === "ready") return { readiness: "ready_for_resume", recommendedAction: "resume_settlement" };
  return { readiness: "blocked_ambiguous_state", recommendedAction: "operator_review_required" };
}

function ensureNoSecretsRendered(value: unknown): void {
  const rendered = JSON.stringify(value);
  for (const sentinel of ["destSecret", "destNullifier", "privateKey", "mnemonic", "seedPhrase", "witness"]) {
    if (rendered.includes(sentinel)) throw new Error(`recovery_snapshot_contains_sensitive_field:${sentinel}`);
  }
}

export async function runRecoverySnapshot(input: {
  env?: Env;
  reader?: Reader;
  nowMs?: number;
} = {}): Promise<HostedRecoverySnapshot> {
  const env = input.env || process.env;
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const destinationHash = normalizeHash(env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_DESTINATION_MESSAGE_HASH);
  const sourceHash = normalizeHash(env.PR012B_SOURCE_MESSAGE_HASH || env.BRIDGE_SOURCE_MESSAGE_HASH);
  const submitSignature = env.PR012B_SUBMIT_TX || null;
  const programId = new PublicKey(env.PROGRAM_ID || DEFAULT_PROGRAM_ID);
  const poolConfig = new PublicKey(env.POOL_CONFIG || DEFAULT_POOL_CONFIG);

  const noteEnv = {
    ...env,
    BRIDGE_NOTE_STATE_INPUT: env.BASE_TO_SOLANA_BRIDGE_STATE_PATH || env.BRIDGE_NOTE_STATE_INPUT,
    BRIDGE_NOTE_EXPECTED_SOURCE_HASH: sourceHash || env.BRIDGE_NOTE_EXPECTED_SOURCE_HASH,
    BRIDGE_NOTE_EXPECTED_DESTINATION_HASH: destinationHash || env.BRIDGE_NOTE_EXPECTED_DESTINATION_HASH,
  };
  const noteState = safeCheckNoteState(noteEnv);
  const noteStatePresent = Boolean(noteState.statePath && fs.existsSync(noteState.statePath));
  const destinationCommitmentHex = commitmentHexFromNoteState(noteState);
  const assetIdBytes = assetIdBytesFromNoteState(noteState);

  const preflightPath = destinationHash ? defaultPreflightPath(destinationHash, env) : null;
  const preflightReport = preflightPath ? readJson<HostedSettleWithdrawPreflight>(preflightPath) : null;
  const preflightAgeSeconds = preflightReport
    ? Math.max(0, Math.floor((nowMs - Date.parse(preflightReport.generatedAt)) / 1000))
    : null;
  const preflight = {
    present: Boolean(preflightReport),
    path: preflightPath,
    sha256: preflightPath ? sha256File(preflightPath) : null,
    readiness: preflightReport?.readiness || null,
    ageSeconds: Number.isFinite(preflightAgeSeconds) ? preflightAgeSeconds : null,
    destinationHashMatches: preflightReport && destinationHash
      ? preflightReport.destinationBridgeMintHash?.toLowerCase() === destinationHash
      : null,
  };

  const indexPath = jobIndexPathFor(env);
  const latestJob = destinationHash ? latestJobForDestination(indexPath, destinationHash) : null;
  const spentNullifierFromPriorResult = spentNullifierFromResult(latestJob);
  const leafIndexEvidence = destinationHash
    ? readLeafIndexEvidence({
        destinationHash,
        env,
        sourceHash,
        destinationCommitment: destinationCommitmentHex,
      })
    : {
        path: null,
        sha256: null,
        evidence: null as LeafIndexEvidence | null,
        errors: ["destination_hash_missing"],
      };

  const pdas: HostedRecoverySnapshot["pdas"] = {
    consumedMessage: null,
    frozenMessage: null,
    commitmentIndex: null,
    pendingBuffer: null,
    poolConfig: null,
    merkleTree: null,
    assetVault: null,
    spentNullifier: null,
  };
  let tx = emptyTx(submitSignature);
  let pending = pendingUnavailable(destinationHash ? "pending_not_checked" : "destination_hash_missing");

  if (destinationHash) {
    const reader = input.reader || (await defaultReader(env, programId));
    if (submitSignature) tx = await reader.getSignature(submitSignature);
    const derived = derivePdas({
      destinationHash,
      destinationCommitmentHex,
      assetIdBytes,
      poolConfig,
      programId,
      spentNullifier: spentNullifierFromPriorResult,
    });
    pdas.consumedMessage = await reader.getAccount(derived.consumedMessage, programId);
    pdas.frozenMessage = await reader.getAccount(derived.frozenMessage, programId);
    pdas.pendingBuffer = await reader.getAccount(derived.pendingBuffer, programId);
    pdas.poolConfig = await reader.getAccount(poolConfig, programId);
    pdas.merkleTree = await reader.getAccount(derived.merkleTree, programId);
    pdas.assetVault = await reader.getAccount(derived.assetVault, programId);
    if (derived.commitmentIndex) pdas.commitmentIndex = await reader.getAccount(derived.commitmentIndex, programId);

    if (destinationCommitmentHex) {
      try {
        const merkleData = await reader.fetchMerkleTree(derived.merkleTree);
        const pendingData = await reader.fetchPendingBuffer(derived.pendingBuffer);
        const fifo = planFifoFromPending({
          pendingData,
          targetCommitmentHex: destinationCommitmentHex,
          commitmentIndexExists: pdas.commitmentIndex?.exists || false,
          nextLeafIndex: Number(merkleData.nextLeafIndex),
          currentMerkleRoot: bytesToHex(merkleData.currentRoot),
        });
        const { ok: _ok, ...planned } = fifo;
        pending = { checked: true, errors: [], ...planned };
      } catch (err) {
        pending = pendingUnavailable(err instanceof Error ? err.message : String(err));
      }
    } else {
      pending = pendingUnavailable("destination_commitment_unavailable_without_note_state");
    }
  }

  let spentNullifierDerivation: SpentNullifierDerivation = {
    derived: false,
    status: "missing_field",
    spentNullifierPda: null,
    leafIndex: null,
    error: "destination_hash_missing",
  };
  let spentNullifierRpcError = false;
  const leafIndexForNullifier =
    leafIndexFromNoteStatePath(noteState.statePath) ??
    leafIndexEvidence.evidence?.leafIndex ??
    (pending.targetPending && pending.nextLeafIndex !== null && pending.fifoPrefixCount !== null
      ? pending.nextLeafIndex + pending.fifoPrefixCount
      : pending.targetAlreadySettled
        ? leafIndexFromResult(latestJob)
        : null);
  if (destinationHash) {
    spentNullifierDerivation = await deriveSpentNullifierPdaFromNoteState({
      noteStatePath: noteState.statePath,
      poolConfig,
      programId,
      leafIndex: leafIndexForNullifier,
    });
    if (spentNullifierDerivation.derived && spentNullifierDerivation.spentNullifierPda) {
      try {
        const reader = input.reader || (await defaultReader(env, programId));
        pdas.spentNullifier = await reader.getAccount(new PublicKey(spentNullifierDerivation.spentNullifierPda), programId);
      } catch {
        spentNullifierRpcError = true;
        pdas.spentNullifier = {
          address: spentNullifierDerivation.spentNullifierPda,
          exists: false,
          owner: null,
          expectedOwnerMatch: null,
        };
      }
    } else if (spentNullifierFromPriorResult) {
      try {
        const reader = input.reader || (await defaultReader(env, programId));
        pdas.spentNullifier = await reader.getAccount(new PublicKey(spentNullifierFromPriorResult), programId);
      } catch {
        spentNullifierRpcError = true;
      }
    }
  }

  const jobIndex = {
    present: fs.existsSync(indexPath),
    path: indexPath,
    latestPhase: latestJob?.status || null,
    latestJobId: latestJob?.jobId || null,
    settlementTx: latestJob?.settlementTx || null,
    withdrawTx: latestJob?.withdrawTx || null,
    duplicateExecutionWouldBlock: latestJob?.status === "succeeded",
    resultReportPath: latestJob?.resultReportPath || null,
    spentNullifier: spentNullifierDerivation.spentNullifierPda || spentNullifierFromPriorResult,
  };

  const classification = classify({
    tx,
    notePresent: noteStatePresent,
    noteOk: noteStateReadyForSnapshot({ ...noteState, present: noteStatePresent }),
    spentNullifierDerivation,
    spentNullifierRpcError,
    preflightPresent: Boolean(preflightReport),
    preflightAgeSeconds: preflight.ageSeconds,
    preflightHashMatches: preflight.destinationHashMatches,
    pending,
    spentNullifierExists: pdas.spentNullifier?.exists ?? null,
    latestJob,
  });

  const reportPath = destinationHash
    ? path.resolve(env.BRIDGE_RECOVERY_SNAPSHOT_PATH || defaultReportPath(destinationHash, env))
    : null;
  const snapshot: HostedRecoverySnapshot = {
    ok: classification.readiness === "ready_for_resume" || classification.readiness.startsWith("already_"),
    generatedAt,
    route: "base-sepolia->solana-devnet",
    destinationMessageHash: destinationHash,
    sourceMessageHash: sourceHash,
    submitTx: tx,
    programId: programId.toBase58(),
    poolConfig: poolConfig.toBase58(),
    noteState: { ...noteState, present: noteStatePresent },
    preflight,
    jobIndex,
    leafIndexEvidence: {
      found: Boolean(leafIndexEvidence.evidence),
      path: leafIndexEvidence.path,
      sha256: leafIndexEvidence.sha256,
      source: leafIndexEvidence.evidence?.evidenceSource || null,
      leafIndex: leafIndexEvidence.evidence?.leafIndex ?? null,
      errors: leafIndexEvidence.errors,
    },
    spentNullifier: {
      ...spentNullifierDerivation,
      exists: pdas.spentNullifier?.exists ?? null,
      checkedAt: spentNullifierDerivation.derived ? generatedAt : null,
      withdrawAlreadyConsumed: pdas.spentNullifier?.exists === true,
    },
    pdas,
    pending,
    readiness: classification.readiness,
    recommendedAction: classification.recommendedAction,
    reportPath,
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
  };
  ensureNoSecretsRendered(snapshot);
  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(reportPath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  }
  return snapshot;
}

async function main(): Promise<void> {
  const snapshot = await runRecoverySnapshot();
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(snapshot.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
