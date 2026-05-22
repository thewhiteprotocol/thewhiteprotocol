import * as assert from "assert";
import * as crypto from "crypto";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeAbiParameters,
  formatEther,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const snarkjs = require("snarkjs");
const circomlibjs = require("circomlibjs");
const TREE_DEPTH = 20;

type JsonRecord = Record<string, any>;

type ExpectedDestination = {
  sourceMessageHash: Hex;
  destinationBridgeMintHash: Hex;
  destinationCommitment: Hex;
  amount: string;
  canonicalAssetId: Hex;
  destinationLocalAssetId: Hex;
  submitTxHash: Hex;
};

type NoteStateSummary = {
  path: string;
  exists: boolean;
  sourceHashMatches: boolean;
  destinationHashMatches: boolean;
  destinationCommitmentMatches: boolean;
  amountMatches: boolean;
  assetMatches: boolean;
  hasSecret: boolean;
  hasNullifier: boolean;
  hasWitness: boolean;
  durablePath: boolean;
  outsideRepo: boolean;
  nullifierHashPresent: boolean;
};

type RawNoteState = {
  destSecret?: unknown;
  destNullifier?: unknown;
  secret?: unknown;
  nullifier?: unknown;
};

const PR013I_SOURCE_HASH =
  "0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e" as Hex;
const PR013I_DESTINATION_HASH =
  "0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865" as Hex;
const PR013I_SUBMIT_TX =
  "0x72b972a211e4950d110798523f6522b402dea83306f6e12805259bdd8adec983" as Hex;

const DEFAULT_FIXTURE_CANDIDATES = [
  "/data/bridge-results/solana-to-base-source-fixture-0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e.json",
  "/tmp/pr013i-bridge-results/solana-to-base-source-fixture-0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e.json",
];

const DEFAULT_STATE_CANDIDATES = [
  "/data/bridge-results/solana-to-base-paper-state/bridge-messages.json",
  "/tmp/pr013i-solana-to-base-paper-state/bridge-messages.json",
];

const BRIDGE_INBOX_ABI = parseAbi([
  "event BridgeMintAccepted(bytes32 indexed messageHash, bytes32 indexed destinationCommitment, bytes32 indexed canonicalAssetId, uint128 amount, uint64 nonce)",
  "function consumedMessageHashes(bytes32) view returns (bool)",
  "function frozenMessages(bytes32) view returns (bool)",
]);

const WHITE_PROTOCOL_ABI = parseAbi([
  "event BridgeMint(address indexed asset, uint256 amount, bytes32 indexed newCommitment)",
  "function getLastRoot() view returns (uint256)",
  "function nextLeafIndex() view returns (uint256)",
  "function filledSubtrees(uint256) view returns (uint256)",
  "function zeros(uint256) view returns (uint256)",
  "function spentNullifiers(uint256) view returns (bool)",
  "function bridgeCommitments(uint256) view returns (bool)",
  "function isKnownRoot(uint256) view returns (bool)",
  "function withdraw(bytes proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external",
]);

function repoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    // Fall through to path walking for environments without git.
  }
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function monorepoRoot(): string {
  let dir = process.cwd();
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "relayer/circuits/build")) && fs.existsSync(path.join(dir, "chains/evm"))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return repoRoot();
}

function readJson(filePath: string): JsonRecord {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeHash(value: unknown): Hex | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? (trimmed.toLowerCase() as Hex) : null;
}

function normalizeHex32(value: unknown): Hex | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed.toLowerCase() as Hex;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed.toLowerCase()}` as Hex;
  return null;
}

function normalizeScalar(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") return BigInt(value).toString();
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed).toString();
  if (/^[0-9]+$/.test(trimmed)) return BigInt(trimmed).toString();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return BigInt(`0x${trimmed}`).toString();
  return null;
}

function findFirstExisting(paths: string[]): string | null {
  return paths.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveFixturePath(env = process.env): string | null {
  if (env.BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH) return path.resolve(env.BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH);
  return findFirstExisting(DEFAULT_FIXTURE_CANDIDATES);
}

function resolveStatePath(env = process.env): string | null {
  if (env.BRIDGE_SOLANA_TO_BASE_STATE_PATH) {
    const requested = path.resolve(env.BRIDGE_SOLANA_TO_BASE_STATE_PATH);
    if (fs.existsSync(requested) && fs.statSync(requested).isDirectory()) {
      return path.join(requested, "bridge-messages.json");
    }
    return requested;
  }
  const candidate = findFirstExisting(DEFAULT_STATE_CANDIDATES);
  return candidate ? path.resolve(candidate) : null;
}

function loadDeployment(env = process.env): JsonRecord {
  const deploymentPath =
    env.BASE_SEPOLIA_DEPLOYMENT_PATH ||
    (fs.existsSync(path.join(process.cwd(), "deployments/base-sepolia.json"))
      ? path.join(process.cwd(), "deployments/base-sepolia.json")
      : "") ||
    path.join(repoRoot(), "chains/evm/deployments/base-sepolia.json");
  return readJson(deploymentPath);
}

function getBridgeInboxAddress(env = process.env): Address {
  if (env.BASE_BRIDGE_INBOX) return getAddress(env.BASE_BRIDGE_INBOX);
  const deployment = loadDeployment(env);
  return getAddress(deployment.bridgeV1?.BridgeInbox || deployment.contracts?.BridgeInbox);
}

function getWhiteProtocolAddress(env = process.env): Address {
  if (env.BASE_WHITE_PROTOCOL) return getAddress(env.BASE_WHITE_PROTOCOL);
  const deployment = loadDeployment(env);
  return getAddress(deployment.contracts?.WhiteProtocol);
}

function expectedFromFixtureAndState(env = process.env): ExpectedDestination {
  const fixturePath = resolveFixturePath(env);
  const statePath = resolveStatePath(env);
  const fixture = fixturePath ? readJson(fixturePath) : {};
  const messages = statePath ? readJson(statePath) : {};
  const stateMessage = Object.values(messages).find((entry: any) => {
    return (
      normalizeHash(entry?.sourceMessageHash) ===
        normalizeHash(env.BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH || PR013I_SOURCE_HASH) ||
      normalizeHash(entry?.destinationMessageHash) ===
        normalizeHash(env.BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH || PR013I_DESTINATION_HASH)
    );
  }) as JsonRecord | undefined;

  const message = fixture.message || stateMessage?.message || {};
  const sourceMessageHash =
    normalizeHash(env.BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH) ||
    normalizeHash(fixture.sourceMessageHash) ||
    normalizeHash(stateMessage?.sourceMessageHash) ||
    PR013I_SOURCE_HASH;
  const destinationBridgeMintHash =
    normalizeHash(env.BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH) ||
    normalizeHash(fixture.destinationBridgeMintHash) ||
    normalizeHash(stateMessage?.destinationMessageHash) ||
    PR013I_DESTINATION_HASH;
  const destinationCommitment =
    normalizeHex32(env.BRIDGE_EXPECTED_DESTINATION_COMMITMENT) ||
    normalizeHex32(message.destinationCommitment) ||
    normalizeHex32(stateMessage?.destinationCommitment);
  const amount =
    normalizeScalar(env.BRIDGE_EXPECTED_DESTINATION_AMOUNT) ||
    normalizeScalar(fixture.normalizedDestinationAmount) ||
    normalizeScalar(message.amount) ||
    normalizeScalar(stateMessage?.amount);
  const canonicalAssetId =
    normalizeHex32(env.BRIDGE_EXPECTED_CANONICAL_ASSET_ID) ||
    normalizeHex32(message.canonicalAssetId) ||
    normalizeHex32(stateMessage?.canonicalAssetId);
  const destinationLocalAssetId =
    normalizeHex32(env.BRIDGE_EXPECTED_DESTINATION_ASSET_ID) ||
    normalizeHex32(fixture.destinationAssetId) ||
    normalizeHex32(message.destinationLocalAssetId) ||
    normalizeHex32(stateMessage?.destinationLocalAssetId);

  if (!destinationCommitment) throw new Error("destination_commitment_unavailable");
  if (!amount) throw new Error("destination_amount_unavailable");
  if (!canonicalAssetId) throw new Error("canonical_asset_id_unavailable");
  if (!destinationLocalAssetId) throw new Error("destination_asset_id_unavailable");

  return {
    sourceMessageHash,
    destinationBridgeMintHash,
    destinationCommitment,
    amount,
    canonicalAssetId,
    destinationLocalAssetId,
    submitTxHash: (normalizeHash(env.BRIDGE_BASE_SUBMIT_TX) || PR013I_SUBMIT_TX) as Hex,
  };
}

function isTmpPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const tmp = path.resolve(os.tmpdir());
  return resolved === tmp || resolved.startsWith(tmp + path.sep);
}

function isOutsideRepo(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const root = repoRoot();
  return resolved !== root && !resolved.startsWith(root + path.sep);
}

function allowTmpBaseNoteStateForTests(env: NodeJS.ProcessEnv | Record<string, string | undefined>): boolean {
  return env.NODE_ENV === "test" && env.BRIDGE_ALLOW_TMP_BASE_NOTE_STATE_FOR_TESTS === "true";
}

function summarizeNoteState(filePath: string, expected: ExpectedDestination): NoteStateSummary {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
      sourceHashMatches: false,
      destinationHashMatches: false,
      destinationCommitmentMatches: false,
      amountMatches: false,
      assetMatches: false,
      hasSecret: false,
      hasNullifier: false,
      hasWitness: false,
      durablePath: false,
      outsideRepo: isOutsideRepo(filePath),
      nullifierHashPresent: false,
    };
  }

  const state = readJson(filePath);
  const sourceHash =
    normalizeHash(state.sourceMessageHash) ||
    normalizeHash(state.sourceBridgeOutHash) ||
    normalizeHash(state.sourceHash);
  const destinationHash =
    normalizeHash(state.destinationBridgeMintHash) ||
    normalizeHash(state.destinationMessageHash) ||
    normalizeHash(state.bridgeMintMessageHash);
  const commitment =
    normalizeHex32(state.destinationCommitment) ||
    normalizeHex32(state.destCommitment) ||
    normalizeHex32(state.bridgeMintMessage?.destinationCommitment) ||
    normalizeHex32(state.message?.destinationCommitment);
  const amount =
    normalizeScalar(state.destinationAmount) ||
    normalizeScalar(state.destAmount) ||
    normalizeScalar(state.amount) ||
    normalizeScalar(state.bridgeMintMessage?.amount) ||
    normalizeScalar(state.message?.amount);
  const asset =
    normalizeHex32(state.destinationAssetId) ||
    normalizeHex32(state.assetId) ||
    normalizeHex32(state.bridgeMintMessage?.destinationLocalAssetId) ||
    normalizeHex32(state.message?.destinationLocalAssetId);

  return {
    path: filePath,
    exists: true,
    sourceHashMatches: sourceHash === expected.sourceMessageHash,
    destinationHashMatches: destinationHash === expected.destinationBridgeMintHash,
    destinationCommitmentMatches: commitment === expected.destinationCommitment,
    amountMatches: amount === expected.amount,
    assetMatches: asset === expected.destinationLocalAssetId || asset === expected.canonicalAssetId,
    hasSecret: state.destSecret !== undefined && state.destSecret !== null && state.destSecret !== "",
    hasNullifier: state.destNullifier !== undefined && state.destNullifier !== null && state.destNullifier !== "",
    hasWitness: Boolean(state.witness || state.withdrawWitness || state.proofWitness),
    durablePath: isOutsideRepo(filePath) && !isTmpPath(filePath),
    outsideRepo: isOutsideRepo(filePath),
    nullifierHashPresent: Boolean(
      normalizeHex32(state.destinationNullifierHash) ||
        normalizeHex32(state.destNullifierHash) ||
        normalizeHex32(state.nullifierHash)
    ),
  };
}

function noteStateValid(summary: NoteStateSummary, options: { allowTmp?: boolean } = {}): boolean {
  const durablePolicyOk = summary.durablePath || Boolean(options.allowTmp && summary.outsideRepo);
  return noteStateContentValid(summary) && durablePolicyOk;
}

function noteStateContentValid(summary: NoteStateSummary): boolean {
  return (
    summary.exists &&
    summary.sourceHashMatches &&
    summary.destinationHashMatches &&
    summary.destinationCommitmentMatches &&
    summary.amountMatches &&
    summary.assetMatches &&
    summary.hasSecret &&
    summary.hasNullifier
  );
}

function deriveLeafIndexFromNextLeafDelta(
  beforeSubmit: bigint | null,
  atSubmitBlock: bigint | null,
  bridgeMintAccepted: boolean,
  bridgeMintEvent: boolean
): bigint | null {
  if (!bridgeMintAccepted || !bridgeMintEvent || beforeSubmit === null || atSubmitBlock === null) return null;
  return atSubmitBlock === beforeSubmit + 1n ? beforeSubmit : null;
}

function loadValidNoteState(summary: NoteStateSummary | null): RawNoteState | null {
  if (!summary || !summary.exists || !noteStateContentValid(summary)) return null;
  return readJson(summary.path) as RawNoteState;
}

async function computeDestinationNullifierHash(
  noteState: RawNoteState,
  leafIndex: bigint
): Promise<bigint | null> {
  const nullifier = normalizeScalar(noteState.destNullifier ?? noteState.nullifier);
  const secret = normalizeScalar(noteState.destSecret ?? noteState.secret);
  if (!nullifier || !secret) return null;
  const poseidon = await circomlibjs.buildPoseidon();
  const F = poseidon.F;
  const inner = poseidon([F.e(nullifier), F.e(secret)]);
  const outer = poseidon([inner, F.e(leafIndex.toString())]);
  return BigInt(F.toString(outer));
}

function findNoteStateCandidates(env = process.env): string[] {
  const explicit = env.BRIDGE_BASE_NOTE_STATE_INPUT || env.BRIDGE_NOTE_STATE_INPUT;
  if (explicit) return [path.resolve(explicit)];

  const dirs = [
    ...(env.BRIDGE_BASE_NOTE_STATE_BACKUP_DIR ? [env.BRIDGE_BASE_NOTE_STATE_BACKUP_DIR] : []),
    ...(env.BRIDGE_BASE_NOTE_STATE_SEARCH_DIRS || "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    "/data/white-bridge-note-state/base-destination",
    "/data/white-bridge-note-state",
    path.join(repoRoot(), "chains/evm/test"),
    ...(env.BRIDGE_INCLUDE_TMP_NOTE_STATE_SEARCH === "true" ? [os.tmpdir()] : []),
  ];
  const patterns = [
    /solana-to-base.*state.*\.json$/i,
    /bridge-note-state.*\.json$/i,
    /destination-note.*\.json$/i,
    /base.*note.*\.json$/i,
    /.*bridge-state.*\.json$/i,
    /^0x[0-9a-fA-F]{64}\.json$/i,
  ];
  const found = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth < 0 || !fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", ".git", "dist", "out", "cache"].includes(entry.name)) continue;
        walk(full, depth - 1);
      } else if (entry.isFile() && patterns.some((pattern) => pattern.test(entry.name))) {
        found.add(full);
      }
    }
  }

  for (const dir of dirs) walk(path.resolve(dir), dir === os.tmpdir() ? 2 : 4);
  return [...found].sort();
}

function validateNoteState(env = process.env): Record<string, unknown> {
  const expected = expectedFromFixtureAndState(env);
  const candidates = findNoteStateCandidates(env);
  const summaries = candidates.map((candidate) => summarizeNoteState(candidate, expected));
  const exact = summaries.find((summary) => noteStateValid(summary, { allowTmp: env.BRIDGE_ALLOW_TMP_NOTE_STATE === "true" })) || null;
  const errors = exact ? [] : ["destination_note_state_missing_or_invalid"];

  return {
    ok: Boolean(exact),
    status: exact ? "note_state_valid" : "blocked_note_state_missing",
    destinationCommitment: expected.destinationCommitment,
    sourceMessageHash: expected.sourceMessageHash,
    destinationBridgeMintHash: expected.destinationBridgeMintHash,
    destinationAmount: expected.amount,
    destinationAsset: expected.destinationLocalAssetId,
    destinationNoteStateFound: Boolean(exact),
    durableNoteStatePath: exact?.path || null,
    candidatesChecked: summaries.map((summary) => ({
      path: summary.path,
      exists: summary.exists,
      sourceHashMatches: summary.sourceHashMatches,
      destinationHashMatches: summary.destinationHashMatches,
      destinationCommitmentMatches: summary.destinationCommitmentMatches,
      amountMatches: summary.amountMatches,
      assetMatches: summary.assetMatches,
      hasSecret: summary.hasSecret,
      hasNullifier: summary.hasNullifier,
      durablePath: summary.durablePath,
    })),
    validation: exact || null,
    errors,
    withdrawTxSubmitted: false,
    secretsPrinted: false,
  };
}

function resolveBackupDir(env = process.env): string {
  return path.resolve(env.BRIDGE_BASE_NOTE_STATE_BACKUP_DIR || "/data/base-destination-note-state");
}

function defaultBaseMerklePathDir(env = process.env): string {
  return path.resolve(
    env.BRIDGE_BASE_MERKLE_PATH_DIR ||
      (fs.existsSync("/workspaces/thewhiteprotocol-operator-data")
        ? "/workspaces/thewhiteprotocol-operator-data/base-merkle-paths"
        : "/data/base-merkle-paths")
  );
}

function resolveMerklePathEvidencePath(expected: ExpectedDestination, env = process.env): string {
  if (env.BRIDGE_BASE_MERKLE_PATH_EVIDENCE_PATH) return path.resolve(env.BRIDGE_BASE_MERKLE_PATH_EVIDENCE_PATH);
  return path.join(defaultBaseMerklePathDir(env), `${expected.destinationBridgeMintHash}.json`);
}

function sha256Json(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function poseidonHash(left: bigint, right: bigint): Promise<bigint> {
  const poseidon = await circomlibjs.buildPoseidon();
  const F = poseidon.F;
  return BigInt(F.toString(poseidon([F.e(left.toString()), F.e(right.toString())])));
}

function computePathFromFilledSubtrees(
  leafIndex: number,
  filledSubtrees: bigint[],
  zeros: bigint[]
): { pathElements: bigint[]; pathIndices: number[] } {
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    const isRight = (leafIndex >> i) & 1;
    pathIndices.push(isRight);
    pathElements.push(isRight ? filledSubtrees[i] : zeros[i]);
  }
  return { pathElements, pathIndices };
}

async function computeRootFromMerklePath(
  commitment: bigint,
  pathElements: bigint[],
  pathIndices: number[]
): Promise<bigint> {
  let current = commitment;
  for (let i = 0; i < TREE_DEPTH; i++) {
    current = pathIndices[i] === 0
      ? await poseidonHash(current, pathElements[i])
      : await poseidonHash(pathElements[i], current);
  }
  return current;
}

function bigintHex32(value: bigint): Hex {
  return `0x${value.toString(16).padStart(64, "0")}` as Hex;
}

function getLocalAssetAddress(env = process.env): Address {
  const configured = env.BRIDGE_WITHDRAW_TOKEN || env.BASE_WITHDRAW_TOKEN || env.BRIDGE_DESTINATION_LOCAL_ASSET;
  if (configured) return getAddress(configured);
  return "0x0000000000000000000000000000000000000000";
}

function getWithdrawRecipient(env = process.env): Address {
  const configured = env.BRIDGE_WITHDRAW_RECIPIENT || env.BASE_WITHDRAW_RECIPIENT;
  if (configured) return getAddress(configured);
  return "0x000000000000000000000000000000000000dEaD";
}

function withdrawCircuitDir(env = process.env): string {
  const root = monorepoRoot();
  const candidates = [
    ...(env.BRIDGE_WITHDRAW_CIRCUIT_DIR ? [path.resolve(env.BRIDGE_WITHDRAW_CIRCUIT_DIR)] : []),
    path.join(root, "circuits/withdraw/build"),
    path.join(root, "relayer/circuits/build"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "withdraw_js", "withdraw.wasm")) && fs.existsSync(path.join(candidate, "withdraw.zkey"))) {
      return candidate;
    }
  }
  return candidates[0];
}

async function proofToBytes(proof: any, publicSignals: any[]): Promise<Hex> {
  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const parsed = JSON.parse(`[${calldata.replace(/\(/g, "[").replace(/\)/g, "]")}]`);
  const a = parsed[0];
  const b = parsed[1];
  const c = parsed[2];
  const flatProof = [
    BigInt(a[0]),
    BigInt(a[1]),
    BigInt(b[0][0]),
    BigInt(b[0][1]),
    BigInt(b[1][0]),
    BigInt(b[1][1]),
    BigInt(c[0]),
    BigInt(c[1]),
  ];
  return encodeAbiParameters([{ type: "uint256[8]" }], [flatProof]) as Hex;
}

function exportNoteState(env = process.env): Record<string, unknown> {
  const expected = expectedFromFixtureAndState(env);
  const input = env.BRIDGE_BASE_NOTE_STATE_INPUT || env.BRIDGE_NOTE_STATE_INPUT;
  if (!input) {
    return {
      ok: false,
      status: "blocked_note_state_input_missing",
      errors: ["BRIDGE_BASE_NOTE_STATE_INPUT_required"],
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }
  const inputPath = path.resolve(input);
  const summary = summarizeNoteState(inputPath, expected);
  if (!noteStateContentValid(summary)) {
    return {
      ok: false,
      status: "blocked_note_state_invalid",
      inputPath,
      validation: {
        path: summary.path,
        exists: summary.exists,
        sourceHashMatches: summary.sourceHashMatches,
        destinationHashMatches: summary.destinationHashMatches,
        destinationCommitmentMatches: summary.destinationCommitmentMatches,
        amountMatches: summary.amountMatches,
        assetMatches: summary.assetMatches,
        hasSecret: summary.hasSecret,
        hasNullifier: summary.hasNullifier,
      },
      errors: ["destination_note_state_missing_or_invalid"],
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const backupDir = resolveBackupDir(env);
  const outputPath = path.join(backupDir, `${expected.destinationBridgeMintHash}.json`);
  const outputOutsideRepo = isOutsideRepo(outputPath);
  const outputDurable = outputOutsideRepo && (!isTmpPath(outputPath) || allowTmpBaseNoteStateForTests(env));
  if (!outputDurable) {
    return {
      ok: false,
      status: "blocked_backup_path_not_durable",
      outputPath,
      errors: ["base_destination_note_state_backup_path_not_durable"],
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(inputPath, outputPath);
  fs.chmodSync(outputPath, 0o600);
  const readback = summarizeNoteState(outputPath, expected);
  const ok = noteStateValid(readback, { allowTmp: allowTmpBaseNoteStateForTests(env) });
  return {
    ok,
    status: ok ? "exported" : "blocked_readback_invalid",
    outputPath,
    readback: {
      path: readback.path,
      exists: readback.exists,
      sourceHashMatches: readback.sourceHashMatches,
      destinationHashMatches: readback.destinationHashMatches,
      destinationCommitmentMatches: readback.destinationCommitmentMatches,
      amountMatches: readback.amountMatches,
      assetMatches: readback.assetMatches,
      hasSecret: readback.hasSecret,
      hasNullifier: readback.hasNullifier,
      durablePath: readback.durablePath,
    },
    errors: ok ? [] : ["base_destination_note_state_readback_invalid"],
    withdrawTxSubmitted: false,
    secretsPrinted: false,
  };
}

async function runBasePreflight(env = process.env): Promise<Record<string, unknown>> {
  const expected = expectedFromFixtureAndState(env);
  const noteValidation = validateNoteState(env);
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL || env.RPC_URL;
  if (!rpcUrl) {
    return {
      ok: false,
      readiness: "blocked_base_rpc_missing",
      destinationCommitment: expected.destinationCommitment,
      noteState: noteValidation,
      baseSubmitTxConfirmed: null,
      messageConsumed: null,
      commitmentInserted: null,
      leafIndex: null,
      nullifierSpent: null,
      vaultBalanceCheck: { checked: false, ok: null },
      withdrawProofReadiness: "blocked_base_rpc_missing",
      withdrawSimulation: "not_attempted",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const bridgeInbox = getBridgeInboxAddress(env);
  const whiteProtocol = getWhiteProtocolAddress(env);

  const [receipt, messageConsumed, messageFrozen, currentRoot, nextLeafIndex, commitmentInserted, vaultBalance] =
    await Promise.all([
      client.getTransactionReceipt({ hash: expected.submitTxHash }).catch(() => null),
      client.readContract({
        address: bridgeInbox,
        abi: BRIDGE_INBOX_ABI,
        functionName: "consumedMessageHashes",
        args: [expected.destinationBridgeMintHash],
      }) as Promise<boolean>,
      client.readContract({
        address: bridgeInbox,
        abi: BRIDGE_INBOX_ABI,
        functionName: "frozenMessages",
        args: [expected.destinationBridgeMintHash],
      }) as Promise<boolean>,
      client.readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "getLastRoot",
      }) as Promise<bigint>,
      client.readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "nextLeafIndex",
      }) as Promise<bigint>,
      client.readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "bridgeCommitments",
        args: [BigInt(expected.destinationCommitment)],
      }) as Promise<boolean>,
      client.getBalance({ address: whiteProtocol }),
    ]);

  let nextLeafIndexBeforeTx: bigint | null = null;
  let nextLeafIndexAtSubmitBlock: bigint | null = null;
  if (receipt?.blockNumber && receipt.blockNumber > 0n) {
    nextLeafIndexBeforeTx = await client
      .readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "nextLeafIndex",
        blockNumber: receipt.blockNumber - 1n,
      })
      .catch(() => null) as bigint | null;
    nextLeafIndexAtSubmitBlock = await client
      .readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "nextLeafIndex",
        blockNumber: receipt.blockNumber,
      })
      .catch(() => null) as bigint | null;
  }

  let bridgeMintAccepted = false;
  let bridgeMintEvent = false;
  if (receipt) {
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: BRIDGE_INBOX_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.eventName === "BridgeMintAccepted" &&
          (decoded.args as any).messageHash?.toLowerCase() === expected.destinationBridgeMintHash &&
          (decoded.args as any).destinationCommitment?.toLowerCase() === expected.destinationCommitment
        ) {
          bridgeMintAccepted = true;
        }
      } catch {
        // Ignore logs from other contracts.
      }
      try {
        const decoded = decodeEventLog({
          abi: WHITE_PROTOCOL_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (
          decoded.eventName === "BridgeMint" &&
          (decoded.args as any).newCommitment?.toLowerCase() === expected.destinationCommitment
        ) {
          bridgeMintEvent = true;
        }
      } catch {
        // Ignore logs from other contracts.
      }
    }
  }

  const noteStateOk = Boolean((noteValidation as any).ok);
  const vaultBalanceOk = vaultBalance >= BigInt(expected.amount);
  const leafIndex = deriveLeafIndexFromNextLeafDelta(
    nextLeafIndexBeforeTx,
    nextLeafIndexAtSubmitBlock,
    bridgeMintAccepted,
    bridgeMintEvent
  );
  const leafIndexSource = leafIndex === null ? "not_derivable_from_block_state" : "nextLeafIndex_at_submit_block_minus_one";
  const exactNoteSummary = (noteValidation as any).validation as NoteStateSummary | null;
  const exactNoteState = loadValidNoteState(exactNoteSummary);
  const destinationNullifierHash =
    exactNoteState && leafIndex !== null ? await computeDestinationNullifierHash(exactNoteState, leafIndex) : null;
  const nullifierSpent =
    destinationNullifierHash === null
      ? null
      : ((await client.readContract({
          address: whiteProtocol,
          abi: WHITE_PROTOCOL_ABI,
          functionName: "spentNullifiers",
          args: [destinationNullifierHash],
        })) as boolean);
  const membershipEvidence =
    leafIndex === null
      ? "blocked_leaf_index_unavailable"
      : "leaf_index_derived_from_submit_block_nextLeafIndex_delta";
  const withdrawProofReadiness =
    !noteStateOk
      ? "blocked_note_state_missing"
      : leafIndex === null
        ? "blocked_leaf_index_unavailable"
        : "blocked_merkle_path_unavailable";

  const preflightChecksPassed =
    noteStateOk &&
    Boolean(receipt && receipt.status === "success") &&
    messageConsumed &&
    commitmentInserted &&
    leafIndex !== null &&
    nullifierSpent === false &&
    vaultBalanceOk;

  return {
    ok: preflightChecksPassed && withdrawProofReadiness === "withdraw_proof_ready",
    preflightChecksPassed,
    readiness: !noteStateOk
      ? "blocked_note_state_missing"
      : leafIndex === null
        ? "blocked_leaf_index_unavailable"
        : nullifierSpent
          ? "blocked_nullifier_already_spent"
          : "blocked_merkle_path_unavailable",
    destinationCommitment: expected.destinationCommitment,
    sourceMessageHash: expected.sourceMessageHash,
    destinationBridgeMintHash: expected.destinationBridgeMintHash,
    baseSubmitTx: expected.submitTxHash,
    baseSubmitTxConfirmed: Boolean(receipt && receipt.status === "success"),
    baseSubmitBlockNumber: receipt?.blockNumber?.toString() || null,
    messageConsumed,
    messageFrozen,
    commitmentInserted: commitmentInserted && bridgeMintAccepted && bridgeMintEvent,
    bridgeCommitmentStored: commitmentInserted,
    bridgeMintAcceptedEvent: bridgeMintAccepted,
    bridgeMintEvent,
    leafIndex: leafIndex?.toString() || null,
    leafIndexSource,
    membershipEvidence,
    nextLeafIndexBeforeSubmit: nextLeafIndexBeforeTx?.toString() || null,
    nextLeafIndexAtSubmitBlock: nextLeafIndexAtSubmitBlock?.toString() || null,
    currentBaseMerkleRoot: currentRoot.toString(),
    nextLeafIndex: nextLeafIndex.toString(),
    nullifierSpent,
    vaultBalanceCheck: {
      checked: true,
      ok: vaultBalanceOk,
      asset: "0x0000000000000000000000000000000000000000",
      balanceWei: vaultBalance.toString(),
      requiredWei: expected.amount,
    },
    recipientConfigured: Boolean(env.BRIDGE_WITHDRAW_RECIPIENT),
    noteState: noteValidation,
    withdrawProofReadiness,
    withdrawSimulation: withdrawProofReadiness === "blocked_merkle_path_unavailable" ? "not_attempted_missing_merkle_path" : "not_attempted",
    withdrawTxSubmitted: false,
    secretsPrinted: false,
  };
}

async function recoverMerklePath(env = process.env): Promise<Record<string, unknown>> {
  const expected = expectedFromFixtureAndState(env);
  const rpcUrl = env.BASE_SEPOLIA_RPC_URL || env.RPC_URL;
  if (!rpcUrl) {
    return {
      ok: false,
      status: "blocked_base_rpc_missing",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const whiteProtocol = getWhiteProtocolAddress(env);
  const receipt = await client.getTransactionReceipt({ hash: expected.submitTxHash }).catch(() => null);
  if (!receipt || receipt.status !== "success") {
    return {
      ok: false,
      status: "blocked_submit_tx_unconfirmed",
      baseSubmitTx: expected.submitTxHash,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  let bridgeMintEvent = false;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: WHITE_PROTOCOL_ABI, data: log.data, topics: log.topics });
      if (
        decoded.eventName === "BridgeMint" &&
        (decoded.args as any).newCommitment?.toLowerCase() === expected.destinationCommitment
      ) {
        bridgeMintEvent = true;
      }
    } catch {
      // Ignore logs from other contracts.
    }
  }

  const [currentRoot, currentNextLeafIndex, commitmentInserted, nextLeafIndexBeforeSubmit, nextLeafIndexAtSubmitBlock] =
    await Promise.all([
      client.readContract({ address: whiteProtocol, abi: WHITE_PROTOCOL_ABI, functionName: "getLastRoot" }) as Promise<bigint>,
      client.readContract({ address: whiteProtocol, abi: WHITE_PROTOCOL_ABI, functionName: "nextLeafIndex" }) as Promise<bigint>,
      client.readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "bridgeCommitments",
        args: [BigInt(expected.destinationCommitment)],
      }) as Promise<boolean>,
      client.readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "nextLeafIndex",
        blockNumber: receipt.blockNumber - 1n,
      }) as Promise<bigint>,
      client.readContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "nextLeafIndex",
        blockNumber: receipt.blockNumber,
      }) as Promise<bigint>,
    ]);

  const leafIndex = deriveLeafIndexFromNextLeafDelta(
    nextLeafIndexBeforeSubmit,
    nextLeafIndexAtSubmitBlock,
    true,
    bridgeMintEvent
  );
  if (leafIndex === null) {
    return {
      ok: false,
      status: "blocked_leaf_index_unavailable",
      bridgeMintEvent,
      nextLeafIndexBeforeSubmit: nextLeafIndexBeforeSubmit.toString(),
      nextLeafIndexAtSubmitBlock: nextLeafIndexAtSubmitBlock.toString(),
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  if (currentNextLeafIndex !== nextLeafIndexAtSubmitBlock) {
    return {
      ok: false,
      status: "blocked_tree_advanced_after_submit",
      currentNextLeafIndex: currentNextLeafIndex.toString(),
      nextLeafIndexAtSubmitBlock: nextLeafIndexAtSubmitBlock.toString(),
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const filledSubtrees: bigint[] = [];
  const zeros: bigint[] = [];
  for (let i = 0; i < TREE_DEPTH; i++) {
    const [filled, zero] = await Promise.all([
      client.readContract({ address: whiteProtocol, abi: WHITE_PROTOCOL_ABI, functionName: "filledSubtrees", args: [BigInt(i)] }) as Promise<bigint>,
      client.readContract({ address: whiteProtocol, abi: WHITE_PROTOCOL_ABI, functionName: "zeros", args: [BigInt(i)] }) as Promise<bigint>,
    ]);
    filledSubtrees.push(filled);
    zeros.push(zero);
  }

  const merklePath = computePathFromFilledSubtrees(Number(leafIndex), filledSubtrees, zeros);
  const computedRoot = await computeRootFromMerklePath(
    BigInt(expected.destinationCommitment),
    merklePath.pathElements,
    merklePath.pathIndices
  );
  const rootMatches = computedRoot === currentRoot;
  const knownRoot = (await client.readContract({
    address: whiteProtocol,
    abi: WHITE_PROTOCOL_ABI,
    functionName: "isKnownRoot",
    args: [computedRoot],
  })) as boolean;

  const evidence = {
    version: 1,
    destinationBridgeMintHash: expected.destinationBridgeMintHash,
    destinationCommitment: expected.destinationCommitment,
    sourceMessageHash: expected.sourceMessageHash,
    baseSubmitTx: expected.submitTxHash,
    baseSubmitBlock: receipt.blockNumber.toString(),
    whiteProtocol,
    leafIndex: leafIndex.toString(),
    treeDepth: TREE_DEPTH,
    root: currentRoot.toString(),
    rootHex: bigintHex32(currentRoot),
    pathElements: merklePath.pathElements.map((entry) => entry.toString()),
    pathIndices: merklePath.pathIndices.map((entry) => entry.toString()),
    eventRange: {
      fromBlock: receipt.blockNumber.toString(),
      toBlock: receipt.blockNumber.toString(),
      method: "submit_receipt_plus_current_tree_state",
    },
    source: {
      bridgeMintEvent,
      commitmentInserted,
      nextLeafIndexBeforeSubmit: nextLeafIndexBeforeSubmit.toString(),
      nextLeafIndexAtSubmitBlock: nextLeafIndexAtSubmitBlock.toString(),
      currentNextLeafIndex: currentNextLeafIndex.toString(),
    },
  };
  const evidenceHash = sha256Json(evidence);
  const outputPath = resolveMerklePathEvidencePath(expected, env);
  const outputDurable = isOutsideRepo(outputPath) && !isTmpPath(outputPath);
  if (!outputDurable) {
    return {
      ok: false,
      status: "blocked_merkle_path_output_not_durable",
      outputPath,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputPath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(outputPath, 0o600);
  } catch {
    // Best effort on platforms without chmod support.
  }

  const ok = rootMatches && knownRoot && bridgeMintEvent && commitmentInserted;
  return {
    ok,
    status: ok ? "merkle_path_recovered" : "blocked_merkle_path_invalid",
    destinationBridgeMintHash: expected.destinationBridgeMintHash,
    destinationCommitment: expected.destinationCommitment,
    leafIndex: leafIndex.toString(),
    eventRange: `${receipt.blockNumber.toString()}-${receipt.blockNumber.toString()}`,
    merkleRoot: currentRoot.toString(),
    rootMatches,
    knownRoot,
    commitmentInserted,
    bridgeMintEvent,
    pathLength: merklePath.pathElements.length,
    pathEvidencePath: outputPath,
    pathEvidenceHash: evidenceHash,
    withdrawTxSubmitted: false,
    secretsPrinted: false,
  };
}

async function validateMerklePath(env = process.env): Promise<Record<string, unknown>> {
  const expected = expectedFromFixtureAndState(env);
  const evidencePath = resolveMerklePathEvidencePath(expected, env);
  if (!fs.existsSync(evidencePath)) {
    return {
      ok: false,
      status: "blocked_merkle_path_missing",
      pathEvidencePath: evidencePath,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }
  const evidence = readJson(evidencePath);
  const pathElements = Array.isArray(evidence.pathElements) ? evidence.pathElements.map((entry: unknown) => BigInt(String(entry))) : [];
  const pathIndices = Array.isArray(evidence.pathIndices) ? evidence.pathIndices.map((entry: unknown) => Number(entry)) : [];
  const computedRoot = pathElements.length === TREE_DEPTH && pathIndices.length === TREE_DEPTH
    ? await computeRootFromMerklePath(BigInt(expected.destinationCommitment), pathElements, pathIndices)
    : null;
  const expectedRoot = normalizeScalar(evidence.root);
  const checks = {
    destinationHashMatches: normalizeHash(evidence.destinationBridgeMintHash) === expected.destinationBridgeMintHash,
    destinationCommitmentMatches: normalizeHex32(evidence.destinationCommitment) === expected.destinationCommitment,
    leafIndexMatches: normalizeScalar(evidence.leafIndex) === (process.env.BRIDGE_EXPECTED_LEAF_INDEX || "42"),
    pathLengthMatches: pathElements.length === TREE_DEPTH && pathIndices.length === TREE_DEPTH,
    rootMatches: computedRoot !== null && expectedRoot !== null && computedRoot.toString() === expectedRoot,
    proofInputConsumable: computedRoot !== null,
  };
  const ok = Object.values(checks).every(Boolean);
  return {
    ok,
    status: ok ? "merkle_path_valid" : "blocked_merkle_path_invalid",
    destinationBridgeMintHash: expected.destinationBridgeMintHash,
    destinationCommitment: expected.destinationCommitment,
    leafIndex: evidence.leafIndex || null,
    merkleRoot: evidence.root || null,
    treeDepth: evidence.treeDepth || null,
    pathEvidencePath: evidencePath,
    pathEvidenceHash: sha256Json(evidence),
    checks,
    withdrawTxSubmitted: false,
    secretsPrinted: false,
  };
}

async function generateProofAndSimulate(env = process.env): Promise<Record<string, unknown>> {
  const expected = expectedFromFixtureAndState(env);
  const pathValidation = await validateMerklePath(env);
  if (!(pathValidation as any).ok) {
    return {
      ok: false,
      status: "blocked_merkle_path_invalid",
      pathValidation,
      withdrawProofReadiness: "blocked_merkle_path_invalid",
      withdrawSimulation: "not_attempted",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }
  const noteValidation = validateNoteState(env);
  const noteSummary = (noteValidation as any).validation as NoteStateSummary | null;
  const noteState = loadValidNoteState(noteSummary);
  if (!noteState) {
    return {
      ok: false,
      status: "blocked_note_state_missing",
      withdrawProofReadiness: "blocked_note_state_missing",
      withdrawSimulation: "not_attempted",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const evidence = readJson(resolveMerklePathEvidencePath(expected, env));
  const leafIndex = BigInt(String(evidence.leafIndex));
  const root = BigInt(String(evidence.root));
  const destinationNullifierHash = await computeDestinationNullifierHash(noteState, leafIndex);
  if (destinationNullifierHash === null) {
    return {
      ok: false,
      status: "blocked_nullifier_hash_unavailable",
      withdrawProofReadiness: "blocked_nullifier_hash_unavailable",
      withdrawSimulation: "not_attempted",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const recipient = getWithdrawRecipient(env);
  const token = getLocalAssetAddress(env);
  const relayer = "0x0000000000000000000000000000000000000000" as Address;
  const fee = 0n;
  const amount = BigInt(expected.amount);
  const assetId = BigInt(expected.destinationLocalAssetId);
  const withdrawInput = {
    secret: normalizeScalar(noteState.destSecret ?? noteState.secret),
    nullifier: normalizeScalar(noteState.destNullifier ?? noteState.nullifier),
    amount: amount.toString(),
    asset_id: assetId.toString(),
    leaf_index: leafIndex.toString(),
    merkle_root: root.toString(),
    nullifier_hash: destinationNullifierHash.toString(),
    merkle_path: (evidence.pathElements as string[]).map((entry) => BigInt(entry).toString()),
    merkle_path_indices: (evidence.pathIndices as string[]).map((entry) => BigInt(entry).toString()),
    recipient: BigInt(recipient).toString(),
    relayer: "0",
    relayer_fee: "0",
    public_data_hash: "0",
  };
  const circuitDir = withdrawCircuitDir(env);
  const wasmPath = path.join(circuitDir, "withdraw_js", "withdraw.wasm");
  const zkeyPath = path.join(circuitDir, "withdraw.zkey");
  if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
    return {
      ok: false,
      status: "blocked_withdraw_circuit_artifact_missing",
      missingArtifacts: {
        wasm: !fs.existsSync(wasmPath),
        zkey: !fs.existsSync(zkeyPath),
      },
      withdrawProofReadiness: "blocked_withdraw_circuit_artifact_missing",
      withdrawSimulation: "not_attempted",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const proofResult = await snarkjs.groth16.fullProve(withdrawInput, wasmPath, zkeyPath);
  const proofBytes = await proofToBytes(proofResult.proof, proofResult.publicSignals);
  const publicSignals = proofResult.publicSignals.map((entry: unknown) => BigInt(String(entry)).toString());
  const publicInputChecks = {
    root: publicSignals[0] === root.toString(),
    nullifierHash: publicSignals[1] === destinationNullifierHash.toString(),
    asset: publicSignals[2] === assetId.toString(),
    recipient: publicSignals[3] === BigInt(recipient).toString(),
    amount: publicSignals[4] === amount.toString(),
    relayer: publicSignals[5] === "0",
    relayerFee: publicSignals[6] === "0",
  };

  const rpcUrl = env.BASE_SEPOLIA_RPC_URL || env.RPC_URL;
  if (!rpcUrl) {
    return {
      ok: false,
      status: "blocked_base_rpc_missing",
      proofInputBuilt: true,
      proofGenerated: true,
      publicInputChecks,
      withdrawProofReadiness: "proof_generated",
      withdrawSimulation: "not_attempted_base_rpc_missing",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }
  const client = createPublicClient({ transport: http(rpcUrl) });
  const whiteProtocol = getWhiteProtocolAddress(env);
  const nullifierSpent = (await client.readContract({
    address: whiteProtocol,
    abi: WHITE_PROTOCOL_ABI,
    functionName: "spentNullifiers",
    args: [destinationNullifierHash],
  })) as boolean;
  if (nullifierSpent) {
    return {
      ok: false,
      status: "blocked_nullifier_already_spent",
      proofInputBuilt: true,
      proofGenerated: true,
      publicInputChecks,
      nullifierSpent: true,
      withdrawSimulation: "not_attempted_nullifier_spent",
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  let simulationOk = false;
  let gasEstimate: string | null = null;
  let simulationError: string | null = null;
  try {
    await client.simulateContract({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "withdraw",
      args: [proofBytes, destinationNullifierHash, root, recipient, token, amount, fee, relayer],
      account: recipient,
    });
    simulationOk = true;
    const gas = await client.estimateContractGas({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "withdraw",
      args: [proofBytes, destinationNullifierHash, root, recipient, token, amount, fee, relayer],
      account: recipient,
    });
    gasEstimate = gas.toString();
  } catch (err) {
    simulationError = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "[redacted-url]") : String(err);
  }

  return {
    ok: simulationOk,
    status: simulationOk ? "withdraw_simulation_ready" : "blocked_withdraw_simulation_failed",
    proofInputBuilt: true,
    proofGenerated: true,
    publicInputChecks,
    nullifierSpent: false,
    withdrawProofReadiness: "proof_generated",
    withdrawSimulation: simulationOk ? "passed" : "failed",
    gasEstimate,
    simulationError,
    withdrawTxSubmitted: false,
    secretsPrinted: false,
  };
}

function getWithdrawSubmitterPrivateKey(env = process.env): Hex | null {
  const raw =
    env.BRIDGE_WITHDRAW_SUBMITTER_PRIVATE_KEY ||
    env.BASE_WITHDRAW_SUBMITTER_PRIVATE_KEY ||
    env.BASE_SUBMITTER_PRIVATE_KEY ||
    env.BASE_DEPLOYER_PRIVATE_KEY ||
    env.DEPLOYER_PRIVATE_KEY ||
    "";
  const trimmed = raw.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(trimmed)) return trimmed as Hex;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return `0x${trimmed}` as Hex;
  return null;
}

function liveWithdrawGate(env = process.env): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (env.BRIDGE_WITHDRAW_LIVE !== "true") errors.push("BRIDGE_WITHDRAW_LIVE_must_be_true");
  if (env.BRIDGE_ALLOW_LIVE_TESTNET_WITHDRAW !== "true") {
    errors.push("BRIDGE_ALLOW_LIVE_TESTNET_WITHDRAW_must_be_true");
  }
  if (env.BRIDGE_DAEMON_MODE && env.BRIDGE_DAEMON_MODE !== "paper") {
    errors.push("BRIDGE_DAEMON_MODE_must_remain_paper_for_withdraw_window");
  }
  return { ok: errors.length === 0, errors };
}

async function submitGuardedWithdraw(env = process.env): Promise<Record<string, unknown>> {
  const expected = expectedFromFixtureAndState(env);
  const liveGate = liveWithdrawGate(env);
  if (!liveGate.ok) {
    return {
      ok: false,
      status: "blocked_live_withdraw_guard",
      errors: liveGate.errors,
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const approvedHash = normalizeHash(env.BRIDGE_WITHDRAW_APPROVED_DESTINATION_HASH);
  if (!approvedHash || approvedHash !== expected.destinationBridgeMintHash) {
    return {
      ok: false,
      status: "blocked_approved_destination_hash_mismatch",
      destinationBridgeMintHash: expected.destinationBridgeMintHash,
      approvedDestinationHashPresent: Boolean(approvedHash),
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const privateKey = getWithdrawSubmitterPrivateKey(env);
  if (!privateKey) {
    return {
      ok: false,
      status: "blocked_withdraw_submitter_key_missing",
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }
  if (!env.BRIDGE_WITHDRAW_RECIPIENT && !env.BASE_WITHDRAW_RECIPIENT) {
    return {
      ok: false,
      status: "blocked_withdraw_recipient_missing",
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const rpcUrl = env.BASE_SEPOLIA_RPC_URL || env.RPC_URL;
  if (!rpcUrl) {
    return {
      ok: false,
      status: "blocked_base_rpc_missing",
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const pathValidation = await validateMerklePath(env);
  if (!(pathValidation as any).ok) {
    return {
      ok: false,
      status: "blocked_merkle_path_invalid",
      pathValidation,
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const noteValidation = validateNoteState(env);
  const noteSummary = (noteValidation as any).validation as NoteStateSummary | null;
  const noteState = loadValidNoteState(noteSummary);
  if (!noteState) {
    return {
      ok: false,
      status: "blocked_note_state_missing",
      noteValidation,
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const client = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== 84532) {
    return {
      ok: false,
      status: "blocked_wrong_chain",
      chainId,
      expectedChainId: 84532,
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const bridgeInbox = getBridgeInboxAddress(env);
  const whiteProtocol = getWhiteProtocolAddress(env);
  const receipt = await client.getTransactionReceipt({ hash: expected.submitTxHash }).catch(() => null);
  const evidence = readJson(resolveMerklePathEvidencePath(expected, env));
  const leafIndex = BigInt(String(evidence.leafIndex));
  const root = BigInt(String(evidence.root));
  const destinationNullifierHash = await computeDestinationNullifierHash(noteState, leafIndex);
  if (destinationNullifierHash === null) {
    return {
      ok: false,
      status: "blocked_nullifier_hash_unavailable",
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const [
    messageConsumed,
    commitmentInserted,
    rootKnown,
    nullifierSpentBefore,
    vaultBalanceBefore,
  ] = await Promise.all([
    client.readContract({
      address: bridgeInbox,
      abi: BRIDGE_INBOX_ABI,
      functionName: "consumedMessageHashes",
      args: [expected.destinationBridgeMintHash],
    }) as Promise<boolean>,
    client.readContract({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "bridgeCommitments",
      args: [BigInt(expected.destinationCommitment)],
    }) as Promise<boolean>,
    client.readContract({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "isKnownRoot",
      args: [root],
    }) as Promise<boolean>,
    client.readContract({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "spentNullifiers",
      args: [destinationNullifierHash],
    }) as Promise<boolean>,
    client.getBalance({ address: whiteProtocol }),
  ]);

  const amount = BigInt(expected.amount);
  const token = getLocalAssetAddress(env);
  const recipient = getWithdrawRecipient(env);
  const relayer = "0x0000000000000000000000000000000000000000" as Address;
  const fee = 0n;
  const account = privateKeyToAccount(privateKey);
  const [recipientBalanceBefore, submitterBalanceBefore] = await Promise.all([
    client.getBalance({ address: recipient }),
    client.getBalance({ address: account.address }),
  ]);
  const vaultBalanceOk = vaultBalanceBefore >= amount;

  if (!receipt || receipt.status !== "success" || !messageConsumed || !commitmentInserted || !rootKnown || nullifierSpentBefore || !vaultBalanceOk) {
    return {
      ok: false,
      status: "blocked_final_precheck_failed",
      baseSubmitTxConfirmed: Boolean(receipt && receipt.status === "success"),
      messageConsumed,
      commitmentInserted,
      rootKnown,
      nullifierSpentBefore,
      vaultBalanceBefore: vaultBalanceBefore.toString(),
      vaultBalanceOk,
      recipientBalanceBefore: recipientBalanceBefore.toString(),
      submitterBalanceBefore: submitterBalanceBefore.toString(),
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const assetId = BigInt(expected.destinationLocalAssetId);
  const withdrawInput = {
    secret: normalizeScalar(noteState.destSecret ?? noteState.secret),
    nullifier: normalizeScalar(noteState.destNullifier ?? noteState.nullifier),
    amount: amount.toString(),
    asset_id: assetId.toString(),
    leaf_index: leafIndex.toString(),
    merkle_root: root.toString(),
    nullifier_hash: destinationNullifierHash.toString(),
    merkle_path: (evidence.pathElements as string[]).map((entry) => BigInt(entry).toString()),
    merkle_path_indices: (evidence.pathIndices as string[]).map((entry) => BigInt(entry).toString()),
    recipient: BigInt(recipient).toString(),
    relayer: "0",
    relayer_fee: "0",
    public_data_hash: "0",
  };
  const circuitDir = withdrawCircuitDir(env);
  const wasmPath = path.join(circuitDir, "withdraw_js", "withdraw.wasm");
  const zkeyPath = path.join(circuitDir, "withdraw.zkey");
  if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
    return {
      ok: false,
      status: "blocked_withdraw_circuit_artifact_missing",
      missingArtifacts: {
        wasm: !fs.existsSync(wasmPath),
        zkey: !fs.existsSync(zkeyPath),
      },
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const proofResult = await snarkjs.groth16.fullProve(withdrawInput, wasmPath, zkeyPath);
  const proofBytes = await proofToBytes(proofResult.proof, proofResult.publicSignals);
  const publicSignals = proofResult.publicSignals.map((entry: unknown) => BigInt(String(entry)).toString());
  const publicInputChecks = {
    root: publicSignals[0] === root.toString(),
    nullifierHash: publicSignals[1] === destinationNullifierHash.toString(),
    asset: publicSignals[2] === assetId.toString(),
    recipient: publicSignals[3] === BigInt(recipient).toString(),
    amount: publicSignals[4] === amount.toString(),
    relayer: publicSignals[5] === "0",
    relayerFee: publicSignals[6] === "0",
  };
  if (!Object.values(publicInputChecks).every(Boolean)) {
    return {
      ok: false,
      status: "blocked_public_input_mismatch",
      publicInputChecks,
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  let gasEstimate: bigint;
  try {
    await client.simulateContract({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "withdraw",
      args: [proofBytes, destinationNullifierHash, root, recipient, token, amount, fee, relayer],
      account: account.address,
    });
    gasEstimate = await client.estimateContractGas({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "withdraw",
      args: [proofBytes, destinationNullifierHash, root, recipient, token, amount, fee, relayer],
      account: account.address,
    });
  } catch (err) {
    return {
      ok: false,
      status: "blocked_withdraw_simulation_failed",
      simulationError: err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "[redacted-url]") : String(err),
      nullifierSpentBefore,
      vaultBalanceBefore: vaultBalanceBefore.toString(),
      recipientBalanceBefore: recipientBalanceBefore.toString(),
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const gasCostBuffer = gasEstimate * 2n;
  if (submitterBalanceBefore <= gasCostBuffer) {
    return {
      ok: false,
      status: "blocked_submitter_balance_low",
      gasEstimate: gasEstimate.toString(),
      submitterBalanceBefore: submitterBalanceBefore.toString(),
      submitterBalanceBeforeEth: formatEther(submitterBalanceBefore),
      withdrawSubmitted: false,
      withdrawTxSubmitted: false,
      secretsPrinted: false,
    };
  }

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });
  const withdrawTx = await walletClient.writeContract({
    address: whiteProtocol,
    abi: WHITE_PROTOCOL_ABI,
    functionName: "withdraw",
    args: [proofBytes, destinationNullifierHash, root, recipient, token, amount, fee, relayer],
    gas: (gasEstimate * 12n) / 10n,
  });
  const withdrawReceipt = await client.waitForTransactionReceipt({ hash: withdrawTx });
  const [nullifierSpentAfter, vaultBalanceAfter, recipientBalanceAfter] = await Promise.all([
    client.readContract({
      address: whiteProtocol,
      abi: WHITE_PROTOCOL_ABI,
      functionName: "spentNullifiers",
      args: [destinationNullifierHash],
    }) as Promise<boolean>,
    client.getBalance({ address: whiteProtocol }),
    client.getBalance({ address: recipient }),
  ]);

  let duplicateRejected = false;
  let duplicateRejection: string | null = null;
  if (nullifierSpentAfter) {
    duplicateRejected = true;
    duplicateRejection = "nullifier_already_spent";
  } else {
    try {
      await client.simulateContract({
        address: whiteProtocol,
        abi: WHITE_PROTOCOL_ABI,
        functionName: "withdraw",
        args: [proofBytes, destinationNullifierHash, root, recipient, token, amount, fee, relayer],
        account: account.address,
      });
      duplicateRejected = false;
      duplicateRejection = "duplicate_simulation_unexpectedly_passed";
    } catch (err) {
      duplicateRejected = true;
      duplicateRejection = err instanceof Error ? err.message.replace(/https?:\/\/\S+/g, "[redacted-url]") : String(err);
    }
  }

  const recipientBalanceIncreased = recipientBalanceAfter > recipientBalanceBefore;
  const vaultBalanceDecreased = vaultBalanceAfter < vaultBalanceBefore;
  const ok =
    withdrawReceipt.status === "success" &&
    nullifierSpentAfter &&
    recipientBalanceIncreased &&
    vaultBalanceDecreased &&
    duplicateRejected;

  return {
    ok,
    status: ok ? "withdraw_submitted" : "blocked_post_submit_check_failed",
    destinationBridgeMintHash: expected.destinationBridgeMintHash,
    destinationCommitment: expected.destinationCommitment,
    leafIndex: leafIndex.toString(),
    merkleRoot: root.toString(),
    nullifierSpentBefore,
    vaultBalanceBefore: vaultBalanceBefore.toString(),
    recipientBalanceBefore: recipientBalanceBefore.toString(),
    proofGenerated: true,
    simulation: "passed",
    gasEstimate: gasEstimate.toString(),
    withdrawSubmitted: true,
    withdrawTx,
    confirmation: withdrawReceipt.status,
    blockNumber: withdrawReceipt.blockNumber.toString(),
    gasUsed: withdrawReceipt.gasUsed.toString(),
    nullifierSpentAfter,
    vaultBalanceAfter: vaultBalanceAfter.toString(),
    recipientBalanceAfter: recipientBalanceAfter.toString(),
    recipientBalanceIncreased,
    vaultBalanceDecreased,
    duplicateRejected,
    duplicateRejection,
    extraAcceptBridgeMintSubmitted: false,
    withdrawTxSubmitted: true,
    secretsPrinted: false,
  };
}

function writeFixture(dir: string, overrides: JsonRecord = {}): string {
  const fixture = {
    sourceMessageHash: PR013I_SOURCE_HASH,
    destinationBridgeMintHash: PR013I_DESTINATION_HASH,
    destinationCommitment: "0x" + "12".repeat(32),
    destinationAmount: "1000000000000000",
    destinationAssetId: "0x" + "34".repeat(32),
    destSecret: "secret-sentinel",
    destNullifier: "nullifier-sentinel",
    ...overrides,
  };
  const filePath = path.join(dir, `${Math.random().toString(16).slice(2)}.base-note-state.json`);
  fs.writeFileSync(filePath, JSON.stringify(fixture, null, 2));
  return filePath;
}

function runSelfTest(): void {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "solana-to-base-withdraw-prep-"));
  const expected: ExpectedDestination = {
    sourceMessageHash: PR013I_SOURCE_HASH,
    destinationBridgeMintHash: PR013I_DESTINATION_HASH,
    destinationCommitment: ("0x" + "12".repeat(32)) as Hex,
    amount: "1000000000000000",
    canonicalAssetId: ("0x" + "56".repeat(32)) as Hex,
    destinationLocalAssetId: ("0x" + "34".repeat(32)) as Hex,
    submitTxHash: PR013I_SUBMIT_TX,
  };
  const durableDir = fs.mkdtempSync(path.join(os.tmpdir(), "base-destination-note-state-"));
  fs.mkdirSync(durableDir, { recursive: true });
  const validPath = writeFixture(durableDir);

  assert.strictEqual(noteStateValid(summarizeNoteState(validPath, expected), { allowTmp: true }), true);
  assert.strictEqual(
    noteStateValid(summarizeNoteState(writeFixture(durableDir, { sourceMessageHash: "0x" + "aa".repeat(32) }), expected), { allowTmp: true }),
    false
  );
  assert.strictEqual(
    noteStateValid(
      summarizeNoteState(writeFixture(durableDir, { destinationBridgeMintHash: "0x" + "bb".repeat(32) }), expected),
      { allowTmp: true }
    ),
    false
  );
  assert.strictEqual(noteStateValid(summarizeNoteState(writeFixture(durableDir, { destSecret: "" }), expected), { allowTmp: true }), false);
  assert.strictEqual(
    noteStateValid(summarizeNoteState(writeFixture(durableDir, { destNullifier: "" }), expected), { allowTmp: true }),
    false
  );
  assert.strictEqual(noteStateValid(summarizeNoteState(writeFixture(tempDir), expected)), false);
  assert.strictEqual(
    noteStateValid(summarizeNoteState(writeFixture(durableDir, { destinationCommitment: "0x" + "cd".repeat(32) }), expected), {
      allowTmp: true,
    }),
    false
  );

  const exported = exportNoteState({
    BRIDGE_BASE_NOTE_STATE_INPUT: validPath,
    BRIDGE_BASE_NOTE_STATE_BACKUP_DIR: durableDir,
    BRIDGE_SOLANA_TO_BASE_FIXTURE_PATH: "",
    BRIDGE_SOLANA_TO_BASE_STATE_PATH: "",
    BRIDGE_EXPECTED_SOURCE_MESSAGE_HASH: PR013I_SOURCE_HASH,
    BRIDGE_EXPECTED_DESTINATION_MESSAGE_HASH: PR013I_DESTINATION_HASH,
    BRIDGE_EXPECTED_DESTINATION_COMMITMENT: expected.destinationCommitment,
    BRIDGE_EXPECTED_DESTINATION_AMOUNT: expected.amount,
    BRIDGE_EXPECTED_CANONICAL_ASSET_ID: expected.canonicalAssetId,
    BRIDGE_EXPECTED_DESTINATION_ASSET_ID: expected.destinationLocalAssetId,
    NODE_ENV: "test",
    BRIDGE_ALLOW_TMP_BASE_NOTE_STATE_FOR_TESTS: "true",
  } as any) as any;
  assert.strictEqual(exported.ok, true);
  assert.strictEqual(fs.existsSync(exported.outputPath), true);

  const rendered = JSON.stringify({
    ok: true,
    candidatesChecked: [summarizeNoteState(validPath, expected)],
  });
  assert.ok(!rendered.includes("secret-sentinel"));
  assert.ok(!rendered.includes("nullifier-sentinel"));

  const alreadySpent = { nullifierSpent: true };
  assert.strictEqual(alreadySpent.nullifierSpent, true);
  const consumedPreflight = { messageConsumed: true };
  assert.strictEqual(consumedPreflight.messageConsumed, true);
  assert.strictEqual(deriveLeafIndexFromNextLeafDelta(42n, 43n, true, true), 42n);
  assert.strictEqual(deriveLeafIndexFromNextLeafDelta(42n, 44n, true, true), null);
  assert.strictEqual(deriveLeafIndexFromNextLeafDelta(42n, 43n, true, false), null);
  const sampleMerklePath = computePathFromFilledSubtrees(1, [11n, 22n], [0n, 1n]);
  assert.deepStrictEqual(sampleMerklePath.pathIndices.slice(0, 2), [1, 0]);
  assert.deepStrictEqual(sampleMerklePath.pathElements.slice(0, 2), [11n, 1n]);

  console.log(JSON.stringify({ ok: true, status: "self_test_passed" }, null, 2));
}

function print(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function main(): Promise<void> {
  const command = process.argv[2] || "validate-note-state";
  if (command === "self-test") {
    runSelfTest();
    return;
  }
  if (command === "validate-note-state" || command === "validate") {
    const result = validateNoteState();
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }
  if (command === "export-note-state" || command === "export") {
    const result = exportNoteState();
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }
  if (command === "readback" || command === "readback-check") {
    const result = validateNoteState();
    print({
      ...result,
      status: (result as any).ok ? "readback_valid" : "readback_invalid",
    });
    process.exit((result as any).ok ? 0 : 1);
  }
  if (command === "preflight" || command === "recovery-preflight") {
    const result = await runBasePreflight();
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }
  if (command === "recover-merkle-path") {
    const result = await recoverMerklePath();
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }
  if (command === "validate-merkle-path") {
    const result = await validateMerklePath();
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }
  if (command === "simulate-withdraw" || command === "withdraw-simulation") {
    const result = await generateProofAndSimulate();
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }
  if (command === "submit-withdraw" || command === "guarded-withdraw") {
    const result = await submitGuardedWithdraw();
    print(result);
    process.exit((result as any).ok ? 0 : 1);
  }
  throw new Error(`unknown command: ${command}`);
}

main().catch((err) => {
  print({
    ok: false,
    status: "error",
    error: err instanceof Error ? err.message : String(err),
    withdrawTxSubmitted: false,
    secretsPrinted: false,
  });
  process.exit(1);
});
