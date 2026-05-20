/**
 * Hosted operator prerequisite check for Base -> Solana settle/withdraw jobs.
 *
 * This command performs no Solana mutations and prints no secret material.
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { bootstrapZkeys, type ZkeyBootstrapResult } from "./hosted-zkey-bootstrap";
import { readLeafIndexEvidence } from "./hosted-leaf-index-evidence";
import type { HostedRecoverySnapshot } from "./hosted-recovery-snapshot";
import type { HostedSettleWithdrawPreflight } from "./hosted-settle-withdraw-preflight";

const DEFAULT_NOTE_STATE_DIR = "/data/white-bridge-note-state";
const DEFAULT_RESULT_DIR = "/data/bridge-results";
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;
const DEFAULT_PROGRAM_ID = "DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD";
const DEFAULT_POOL_CONFIG = "DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

type Readiness =
  | "ready"
  | "blocked_zkeys"
  | "blocked_note_state"
  | "blocked_preflight"
  | "blocked_recovery_snapshot"
  | "blocked_leaf_index"
  | "blocked_wallet"
  | "blocked_safe_mode";

type RecommendedAction =
  | "run_bootstrap_zkeys"
  | "restore_note_state"
  | "run_preflight"
  | "run_recovery_snapshot"
  | "run_dry_run_job"
  | "operator_review_required";

export type OperatorPrereqResult = {
  ok: boolean;
  readiness: Readiness;
  recommendedAction: RecommendedAction;
  destinationHash: string | null;
  sourceHash: string | null;
  safeMode: {
    ok: boolean;
    daemonMode: string | null;
    liveSubmitEnabled: boolean;
    errors: string[];
  };
  zkeys: ZkeyBootstrapResult;
  noteState: {
    ok: boolean;
    dir: string;
    exists: boolean;
    notTmp: boolean;
    errors: string[];
  };
  bridgeResults: {
    ok: boolean;
    dir: string;
    exists: boolean;
    notTmp: boolean;
    errors: string[];
  };
  leafIndexEvidence: {
    checked: boolean;
    ok: boolean;
    path: string | null;
    sha256: string | null;
    source: string | null;
    leafIndex: number | null;
    errors: string[];
  };
  preflight: {
    checked: boolean;
    ok: boolean;
    path: string | null;
    sha256: string | null;
    ageSeconds: number | null;
    readiness: string | null;
    destinationHashMatches: boolean | null;
    errors: string[];
  };
  recoverySnapshot: {
    checked: boolean;
    ok: boolean;
    path: string | null;
    sha256: string | null;
    ageSeconds: number | null;
    readiness: string | null;
    recommendedAction: string | null;
    destinationHashMatches: boolean | null;
    errors: string[];
  };
  wallet: {
    checked: boolean;
    ok: boolean;
    walletPublicKey: string | null;
    expectedPoolAuthority: string | null;
    poolAuthorityMatches: boolean | null;
    errors: string[];
  };
  errors: string[];
  transactionsSubmitted: false;
  proofsGenerated: false;
  secretsPrinted: false;
};

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isTmpPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  const tmp = path.resolve(os.tmpdir());
  return resolved === tmp || resolved.startsWith(tmp + path.sep);
}

function resultDir(env: Env): string {
  return path.resolve(env.BRIDGE_RESULTS_DIR || env.PR012G_PREFLIGHT_RESULT_DIR || DEFAULT_RESULT_DIR);
}

function destinationFileName(destinationHash: string): string {
  return `${destinationHash.slice(2)}.bridge-note-state.json`;
}

function preflightPathFor(destinationHash: string, env: Env): string {
  if (env.BRIDGE_PREFLIGHT_REPORT_PATH) return path.resolve(env.BRIDGE_PREFLIGHT_REPORT_PATH);
  return path.join(resultDir(env), `preflight-${destinationHash.slice(2)}.json`);
}

function recoverySnapshotPathFor(destinationHash: string, env: Env): string {
  if (env.BRIDGE_RECOVERY_SNAPSHOT_PATH) return path.resolve(env.BRIDGE_RECOVERY_SNAPSHOT_PATH);
  return path.join(resultDir(env), `recovery-snapshot-${destinationHash.slice(2)}.json`);
}

function ageSeconds(generatedAt: unknown, nowMs: number): number | null {
  if (typeof generatedAt !== "string") return null;
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((nowMs - parsed) / 1000);
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function loadKeypairPublicKey(raw: string): string {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== 64) throw new Error("keypair_invalid");
  return Keypair.fromSecretKey(Uint8Array.from(parsed)).publicKey.toBase58();
}

function walletPublicKeyFromEnv(env: Env): string | null {
  if (env.ANCHOR_WALLET && fs.existsSync(env.ANCHOR_WALLET)) {
    return loadKeypairPublicKey(fs.readFileSync(env.ANCHOR_WALLET, "utf8"));
  }
  if (env.SOLANA_POOL_AUTHORITY_KEYPAIR) return loadKeypairPublicKey(env.SOLANA_POOL_AUTHORITY_KEYPAIR);
  if (env.RELAYER_KEYPAIR) return loadKeypairPublicKey(env.RELAYER_KEYPAIR);
  return null;
}

async function checkWallet(env: Env): Promise<OperatorPrereqResult["wallet"]> {
  const wallet = {
    checked: false,
    ok: true,
    walletPublicKey: null as string | null,
    expectedPoolAuthority: null as string | null,
    poolAuthorityMatches: null as boolean | null,
    errors: [] as string[],
  };
  const hasWallet = Boolean(env.ANCHOR_WALLET || env.SOLANA_POOL_AUTHORITY_KEYPAIR || env.RELAYER_KEYPAIR);
  if (!hasWallet) return wallet;
  wallet.checked = true;
  try {
    wallet.walletPublicKey = walletPublicKeyFromEnv(env);
  } catch {
    wallet.errors.push("wallet_public_key_unavailable");
  }
  if (env.BRIDGE_EXPECTED_POOL_AUTHORITY) {
    wallet.expectedPoolAuthority = env.BRIDGE_EXPECTED_POOL_AUTHORITY;
  } else if (env.PR012P_SKIP_WALLET_RPC !== "true") {
    try {
      const rpcUrl = env.ANCHOR_PROVIDER_URL || env.SOLANA_DEVNET_RPC_URL || env.RPC_ENDPOINT || "https://api.devnet.solana.com";
      const idlPath = env.IDL_PATH || path.join(process.cwd(), "sdk/src/idl/white_protocol.json");
      const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
      const programId = new PublicKey(env.PROGRAM_ID || idl.address || DEFAULT_PROGRAM_ID);
      const poolConfig = new PublicKey(env.POOL_CONFIG || DEFAULT_POOL_CONFIG);
      const connection = new Connection(rpcUrl, "confirmed");
      const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(Keypair.generate()), { commitment: "confirmed" });
      (idl as any).address = programId.toBase58();
      const program = new anchor.Program(idl as any, provider);
      const poolData = await (program.account as any).poolConfig.fetch(poolConfig);
      wallet.expectedPoolAuthority = poolData.authority.toBase58();
    } catch {
      wallet.errors.push("pool_authority_unavailable");
    }
  }
  if (wallet.walletPublicKey && wallet.expectedPoolAuthority) {
    wallet.poolAuthorityMatches = wallet.walletPublicKey === wallet.expectedPoolAuthority;
    if (!wallet.poolAuthorityMatches) wallet.errors.push("wallet_does_not_match_pool_authority");
  } else if (env.PR012P_SKIP_WALLET_RPC !== "true" || env.BRIDGE_EXPECTED_POOL_AUTHORITY) {
    wallet.errors.push("wallet_authority_match_unavailable");
  }
  wallet.ok = wallet.errors.length === 0;
  return wallet;
}

function checkPathDir(dir: string): { ok: boolean; dir: string; exists: boolean; notTmp: boolean; errors: string[] } {
  const exists = fs.existsSync(dir);
  const notTmp = !isTmpPath(dir);
  const errors: string[] = [];
  if (!exists) errors.push("path_missing");
  if (!notTmp) errors.push("path_tmp_blocked");
  return { ok: errors.length === 0, dir, exists, notTmp, errors };
}

export async function runOperatorPrereq(input: {
  env?: Env;
  nowMs?: number;
} = {}): Promise<OperatorPrereqResult> {
  const env = input.env || process.env;
  const nowMs = input.nowMs ?? Date.now();
  const destinationHash = normalizeHash(env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_DESTINATION_MESSAGE_HASH);
  const sourceHash = normalizeHash(env.PR012B_SOURCE_MESSAGE_HASH || env.BRIDGE_SOURCE_MESSAGE_HASH);
  const safeErrors: string[] = [];
  const daemonMode = env.BRIDGE_DAEMON_MODE || null;
  const liveSubmitEnabled = env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === "true";
  if (daemonMode !== "paper") safeErrors.push("daemon_mode_not_paper");
  if (liveSubmitEnabled) safeErrors.push("live_submit_enabled");

  const zkeys = bootstrapZkeys({ env, createSymlinks: true });
  const noteDir = path.resolve(env.BRIDGE_NOTE_STATE_BACKUP_DIR || DEFAULT_NOTE_STATE_DIR);
  const resultsDir = resultDir(env);
  const noteState = checkPathDir(noteDir);
  const bridgeResults = checkPathDir(resultsDir);
  if (destinationHash && noteState.exists && !fs.existsSync(path.join(noteDir, destinationFileName(destinationHash)))) {
    noteState.ok = false;
    noteState.errors.push("note_state_file_missing");
  }

  const maxAge = Number(env.BRIDGE_PREFLIGHT_MAX_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS);
  const snapshotMaxAge = Number(env.BRIDGE_RECOVERY_SNAPSHOT_MAX_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS);
  const leaf = {
    checked: Boolean(destinationHash),
    ok: !destinationHash,
    path: null as string | null,
    sha256: null as string | null,
    source: null as string | null,
    leafIndex: null as number | null,
    errors: [] as string[],
  };
  if (destinationHash) {
    const read = readLeafIndexEvidence({ destinationHash, env, sourceHash });
    leaf.path = read.path;
    leaf.sha256 = read.sha256;
    leaf.errors.push(...read.errors);
    leaf.ok = read.errors.length === 0 && Boolean(read.evidence);
    leaf.source = read.evidence?.evidenceSource || null;
    leaf.leafIndex = read.evidence?.leafIndex ?? null;
  }

  const preflight = {
    checked: Boolean(destinationHash),
    ok: !destinationHash,
    path: null as string | null,
    sha256: null as string | null,
    ageSeconds: null as number | null,
    readiness: null as string | null,
    destinationHashMatches: null as boolean | null,
    errors: [] as string[],
  };
  if (destinationHash) {
    preflight.path = preflightPathFor(destinationHash, env);
    const report = readJson<HostedSettleWithdrawPreflight>(preflight.path);
    preflight.sha256 = sha256File(preflight.path);
    if (!report) {
      preflight.errors.push("preflight_missing");
    } else {
      preflight.ageSeconds = ageSeconds(report.generatedAt, nowMs);
      preflight.readiness = report.readiness;
      preflight.destinationHashMatches = report.destinationBridgeMintHash === destinationHash;
      if (report.readiness !== "ready") preflight.errors.push(`preflight_not_ready:${report.readiness}`);
      if (preflight.ageSeconds === null || preflight.ageSeconds > maxAge) preflight.errors.push("preflight_stale");
      if (!preflight.destinationHashMatches) preflight.errors.push("preflight_destination_hash_mismatch");
    }
    preflight.ok = preflight.errors.length === 0;
  }

  const recoverySnapshot = {
    checked: Boolean(destinationHash),
    ok: !destinationHash,
    path: null as string | null,
    sha256: null as string | null,
    ageSeconds: null as number | null,
    readiness: null as string | null,
    recommendedAction: null as string | null,
    destinationHashMatches: null as boolean | null,
    errors: [] as string[],
  };
  if (destinationHash) {
    recoverySnapshot.path = recoverySnapshotPathFor(destinationHash, env);
    const snapshot = readJson<HostedRecoverySnapshot>(recoverySnapshot.path);
    recoverySnapshot.sha256 = sha256File(recoverySnapshot.path);
    if (!snapshot) {
      recoverySnapshot.errors.push("recovery_snapshot_missing");
    } else {
      recoverySnapshot.ageSeconds = ageSeconds(snapshot.generatedAt, nowMs);
      recoverySnapshot.readiness = snapshot.readiness;
      recoverySnapshot.recommendedAction = snapshot.recommendedAction;
      recoverySnapshot.destinationHashMatches = snapshot.destinationMessageHash === destinationHash;
      if (recoverySnapshot.ageSeconds === null || recoverySnapshot.ageSeconds > snapshotMaxAge) {
        recoverySnapshot.errors.push("recovery_snapshot_stale");
      }
      if (!recoverySnapshot.destinationHashMatches) recoverySnapshot.errors.push("recovery_snapshot_destination_hash_mismatch");
      if (
        snapshot.readiness !== "ready_for_resume" &&
        snapshot.readiness !== "already_withdrawn_spent_nullifier"
      ) {
        recoverySnapshot.errors.push(`recovery_snapshot_not_ready:${snapshot.readiness}`);
      }
    }
    recoverySnapshot.ok = recoverySnapshot.errors.length === 0;
  }

  const wallet = await checkWallet(env);
  const errors: string[] = [];
  if (safeErrors.length > 0) errors.push(...safeErrors);
  if (!zkeys.ok) errors.push(...zkeys.errors);
  if (!noteState.ok) errors.push(...noteState.errors.map((error) => `note_state_${error}`));
  if (!bridgeResults.ok) errors.push(...bridgeResults.errors.map((error) => `bridge_results_${error}`));
  if (!leaf.ok) errors.push(...leaf.errors);
  if (!preflight.ok) errors.push(...preflight.errors);
  if (!recoverySnapshot.ok) errors.push(...recoverySnapshot.errors);
  if (!wallet.ok) errors.push(...wallet.errors);

  let readiness: Readiness = "ready";
  let recommendedAction: RecommendedAction = "run_dry_run_job";
  if (safeErrors.length > 0) {
    readiness = "blocked_safe_mode";
    recommendedAction = "operator_review_required";
  } else if (!zkeys.ok) {
    readiness = "blocked_zkeys";
    recommendedAction = "run_bootstrap_zkeys";
  } else if (!noteState.ok || !bridgeResults.ok) {
    readiness = "blocked_note_state";
    recommendedAction = "restore_note_state";
  } else if (!leaf.ok) {
    readiness = "blocked_leaf_index";
    recommendedAction = "operator_review_required";
  } else if (!preflight.ok) {
    readiness = "blocked_preflight";
    recommendedAction = "run_preflight";
  } else if (!recoverySnapshot.ok) {
    readiness = "blocked_recovery_snapshot";
    recommendedAction = "run_recovery_snapshot";
  } else if (!wallet.ok) {
    readiness = "blocked_wallet";
    recommendedAction = "operator_review_required";
  }

  return {
    ok: readiness === "ready",
    readiness,
    recommendedAction,
    destinationHash,
    sourceHash,
    safeMode: {
      ok: safeErrors.length === 0,
      daemonMode,
      liveSubmitEnabled,
      errors: safeErrors,
    },
    zkeys,
    noteState,
    bridgeResults,
    leafIndexEvidence: leaf,
    preflight,
    recoverySnapshot,
    wallet,
    errors,
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
  };
}

async function main(): Promise<void> {
  const result = await runOperatorPrereq();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
