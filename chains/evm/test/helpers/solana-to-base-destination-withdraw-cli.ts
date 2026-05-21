import * as assert from "assert";
import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

const circomlibjs = require("circomlibjs");

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
  "function spentNullifiers(uint256) view returns (bool)",
  "function bridgeCommitments(uint256) view returns (bool)",
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
