/**
 * Read-only hosted operator status summary for Base -> Solana settlement and
 * withdraw readiness. This command reads existing reports/artifacts and writes
 * a non-secret summary report.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { bootstrapZkeys } from "./hosted-zkey-bootstrap";
import { readLeafIndexEvidence } from "./hosted-leaf-index-evidence";
import type { HostedRecoverySnapshot } from "./hosted-recovery-snapshot";
import { jobIndexPathFor, type OperatorJobEntry, type OperatorJobIndex } from "./hosted-settle-withdraw-job";
import type { HostedSettleWithdrawPreflight } from "./hosted-settle-withdraw-preflight";

const DEFAULT_NOTE_STATE_DIR = "/data/white-bridge-note-state";
const DEFAULT_RESULT_DIR = "/data/bridge-results";
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type OperatorStatusReadiness =
  | "ready_for_dry_run_job"
  | "ready_for_execute"
  | "blocked_zkeys"
  | "blocked_note_state"
  | "blocked_preflight_missing"
  | "blocked_preflight_stale"
  | "blocked_recovery_missing"
  | "blocked_recovery_stale"
  | "blocked_leaf_index_missing"
  | "blocked_job_incomplete"
  | "already_complete"
  | "operator_review_required";

export type OperatorStatusRecommendedAction =
  | "run_bootstrap_zkeys"
  | "restore_note_state"
  | "run_preflight"
  | "run_recovery_snapshot"
  | "run_leaf_index_evidence"
  | "run_job_dry_run"
  | "run_job_execute"
  | "no_action_already_complete"
  | "operator_review_required";

export type HostedOperatorStatus = {
  ok: boolean;
  generatedAt: string;
  destinationMessageHash: string | null;
  sourceMessageHash: string | null;
  safeMode: {
    daemonMode: string | null;
    liveSubmitEnabled: boolean;
    ok: boolean;
  };
  zkeys: {
    artifactDir: string;
    merkleHashMatches: boolean;
    withdrawHashMatches: boolean;
    merkleLinkTargetMatches: boolean;
    withdrawLinkTargetMatches: boolean;
    ok: boolean;
    errors: string[];
  };
  noteState: {
    dir: string;
    path: string | null;
    fileFound: boolean;
    hasDestSecret: boolean;
    hasDestNullifier: boolean;
    ok: boolean;
  };
  preflight: {
    path: string | null;
    present: boolean;
    sha256: string | null;
    ageSeconds: number | null;
    status: string | null;
    destinationHashMatches: boolean | null;
    ok: boolean;
  };
  recovery: {
    path: string | null;
    present: boolean;
    sha256: string | null;
    ageSeconds: number | null;
    readiness: string | null;
    recommendedAction: string | null;
    destinationHashMatches: boolean | null;
    spentNullifierPda: string | null;
    spentNullifierExists: boolean | null;
    withdrawAlreadyConsumed: boolean | null;
    ok: boolean;
  };
  leafIndex: {
    path: string | null;
    present: boolean;
    sha256: string | null;
    leafIndex: number | null;
    evidenceSource: string | null;
    ok: boolean;
    errors: string[];
  };
  job: {
    indexPath: string;
    latestStatus: string | null;
    latestPhase: string | null;
    preflightHash: string | null;
    recoveryHash: string | null;
    settlementTx: string | null;
    withdrawTx: string | null;
    resultReportPath: string | null;
    ok: boolean;
  };
  resultReport: {
    path: string | null;
    present: boolean;
    sha256: string | null;
  };
  final: {
    readiness: OperatorStatusReadiness;
    recommendedAction: OperatorStatusRecommendedAction;
  };
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

function resultDir(env: Env): string {
  return path.resolve(env.BRIDGE_RESULTS_DIR || env.PR012G_PREFLIGHT_RESULT_DIR || DEFAULT_RESULT_DIR);
}

function noteStateDir(env: Env): string {
  return path.resolve(env.BRIDGE_NOTE_STATE_BACKUP_DIR || DEFAULT_NOTE_STATE_DIR);
}

function sha256File(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson<T>(filePath: string | null): T | null {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function ageSeconds(generatedAt: unknown, nowMs: number): number | null {
  if (typeof generatedAt !== "string") return null;
  const parsed = Date.parse(generatedAt);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((nowMs - parsed) / 1000);
}

function reportPath(kind: "preflight" | "recovery-snapshot" | "operator-status" | "settle-withdraw", destinationHash: string, env: Env): string {
  if (kind === "preflight" && env.BRIDGE_PREFLIGHT_REPORT_PATH) return path.resolve(env.BRIDGE_PREFLIGHT_REPORT_PATH);
  if (kind === "recovery-snapshot" && env.BRIDGE_RECOVERY_SNAPSHOT_PATH) return path.resolve(env.BRIDGE_RECOVERY_SNAPSHOT_PATH);
  if (kind === "operator-status" && env.BRIDGE_OPERATOR_STATUS_PATH) return path.resolve(env.BRIDGE_OPERATOR_STATUS_PATH);
  return path.join(resultDir(env), `${kind}-${destinationHash.slice(2)}.json`);
}

function notePath(destinationHash: string | null, env: Env): string | null {
  if (!destinationHash) return null;
  return path.join(noteStateDir(env), `${destinationHash.slice(2)}.bridge-note-state.json`);
}

function summarizeNoteState(destinationHash: string | null, env: Env): HostedOperatorStatus["noteState"] {
  const dir = noteStateDir(env);
  const statePath = notePath(destinationHash, env);
  const state = readJson<Record<string, unknown>>(statePath);
  return {
    dir,
    path: statePath,
    fileFound: Boolean(state),
    hasDestSecret: state?.destSecret !== undefined && state.destSecret !== null && state.destSecret !== "",
    hasDestNullifier: state?.destNullifier !== undefined && state.destNullifier !== null && state.destNullifier !== "",
    ok: Boolean(state && state.destSecret !== undefined && state.destNullifier !== undefined),
  };
}

function readJobIndex(indexPath: string): OperatorJobIndex {
  const parsed = readJson<Partial<OperatorJobIndex>>(indexPath);
  return { version: 1, jobs: Array.isArray(parsed?.jobs) ? parsed.jobs : [] };
}

function latestJob(destinationHash: string | null, env: Env): { indexPath: string; job: OperatorJobEntry | null } {
  const indexPath = jobIndexPathFor(env);
  const index = readJobIndex(indexPath);
  const jobs = destinationHash
    ? index.jobs.filter((job) => job.destinationMessageHash?.toLowerCase() === destinationHash)
    : index.jobs;
  return { indexPath, job: jobs.length > 0 ? jobs[jobs.length - 1] : null };
}

function determineReadiness(input: {
  safeOk: boolean;
  zkeysOk: boolean;
  noteOk: boolean;
  preflightPresent: boolean;
  preflightOk: boolean;
  preflightAge: number | null;
  recoveryPresent: boolean;
  recoveryOk: boolean;
  recoveryAge: number | null;
  recoveryReadiness: string | null;
  leafOk: boolean;
  latestJob: OperatorJobEntry | null;
  maxAge: number;
}): { readiness: OperatorStatusReadiness; recommendedAction: OperatorStatusRecommendedAction } {
  if (!input.safeOk) return { readiness: "operator_review_required", recommendedAction: "operator_review_required" };
  if (!input.zkeysOk) return { readiness: "blocked_zkeys", recommendedAction: "run_bootstrap_zkeys" };
  if (!input.noteOk) return { readiness: "blocked_note_state", recommendedAction: "restore_note_state" };
  if (!input.leafOk) return { readiness: "blocked_leaf_index_missing", recommendedAction: "run_leaf_index_evidence" };
  if (!input.preflightPresent) return { readiness: "blocked_preflight_missing", recommendedAction: "run_preflight" };
  if (input.preflightAge === null || input.preflightAge > input.maxAge) {
    return { readiness: "blocked_preflight_stale", recommendedAction: "run_preflight" };
  }
  if (!input.preflightOk) return { readiness: "operator_review_required", recommendedAction: "operator_review_required" };
  if (!input.recoveryPresent) return { readiness: "blocked_recovery_missing", recommendedAction: "run_recovery_snapshot" };
  if (input.recoveryAge === null || input.recoveryAge > input.maxAge) {
    return { readiness: "blocked_recovery_stale", recommendedAction: "run_recovery_snapshot" };
  }
  if (!input.recoveryOk) return { readiness: "operator_review_required", recommendedAction: "operator_review_required" };
  if (input.latestJob?.status === "succeeded") {
    return { readiness: "already_complete", recommendedAction: "no_action_already_complete" };
  }
  if (input.recoveryReadiness === "already_withdrawn_spent_nullifier") {
    return { readiness: "already_complete", recommendedAction: "no_action_already_complete" };
  }
  if (input.latestJob?.status === "dry_run_ready") {
    return { readiness: "ready_for_execute", recommendedAction: "run_job_execute" };
  }
  if (input.latestJob && input.latestJob.status !== "dry_run_ready") {
    return { readiness: "blocked_job_incomplete", recommendedAction: "run_job_dry_run" };
  }
  return { readiness: "ready_for_dry_run_job", recommendedAction: "run_job_dry_run" };
}

function ensureNoSecretsRendered(value: unknown): void {
  const rendered = JSON.stringify(value);
  for (const sentinel of ["destSecret", "destNullifier", "privateKey", "mnemonic", "seedPhrase", "witness", "operatorToken"]) {
    if (rendered.includes(sentinel)) throw new Error(`operator_status_contains_sensitive_field:${sentinel}`);
  }
}

export function buildOperatorStatus(input: {
  env?: Env;
  nowMs?: number;
  writeReport?: boolean;
} = {}): HostedOperatorStatus {
  const env = input.env || process.env;
  const nowMs = input.nowMs ?? Date.now();
  const generatedAt = new Date(nowMs).toISOString();
  const destinationHash = normalizeHash(env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_DESTINATION_MESSAGE_HASH);
  const sourceHash = normalizeHash(env.PR012B_SOURCE_MESSAGE_HASH || env.BRIDGE_SOURCE_MESSAGE_HASH);
  const maxAge = Number(env.BRIDGE_OPERATOR_STATUS_MAX_AGE_SECONDS || env.BRIDGE_PREFLIGHT_MAX_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS);
  const safeMode = {
    daemonMode: env.BRIDGE_DAEMON_MODE || null,
    liveSubmitEnabled: env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT === "true",
    ok: env.BRIDGE_DAEMON_MODE === "paper" && env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT !== "true",
  };
  const zkeyCheck = bootstrapZkeys({ env, createSymlinks: false });
  const zkeys = {
    artifactDir: zkeyCheck.artifactDir,
    merkleHashMatches: zkeyCheck.merkleZkey.hashMatches,
    withdrawHashMatches: zkeyCheck.withdrawZkey.hashMatches,
    merkleLinkTargetMatches: zkeyCheck.merkleZkey.linkTargetMatches,
    withdrawLinkTargetMatches: zkeyCheck.withdrawZkey.linkTargetMatches,
    ok: zkeyCheck.ok,
    errors: zkeyCheck.errors,
  };
  const noteState = summarizeNoteState(destinationHash, env);
  const leafRead = destinationHash
    ? readLeafIndexEvidence({ destinationHash, env, sourceHash })
    : { path: null, sha256: null, evidence: null, errors: ["destination_hash_missing"] };
  const leafIndex = {
    path: leafRead.path,
    present: Boolean(leafRead.evidence),
    sha256: leafRead.sha256,
    leafIndex: leafRead.evidence?.leafIndex ?? null,
    evidenceSource: leafRead.evidence?.evidenceSource ?? null,
    ok: Boolean(leafRead.evidence) && leafRead.errors.length === 0,
    errors: leafRead.errors,
  };
  const preflightPath = destinationHash ? reportPath("preflight", destinationHash, env) : null;
  const preflightReport = readJson<HostedSettleWithdrawPreflight>(preflightPath);
  const preflightAge = ageSeconds(preflightReport?.generatedAt, nowMs);
  const preflight = {
    path: preflightPath,
    present: Boolean(preflightReport),
    sha256: preflightPath ? sha256File(preflightPath) : null,
    ageSeconds: preflightAge,
    status: preflightReport?.readiness ?? null,
    destinationHashMatches: destinationHash && preflightReport ? preflightReport.destinationBridgeMintHash === destinationHash : null,
    ok: Boolean(preflightReport && preflightReport.readiness === "ready" && preflightReport.destinationBridgeMintHash === destinationHash),
  };
  const recoveryPath = destinationHash ? reportPath("recovery-snapshot", destinationHash, env) : null;
  const recoveryReport = readJson<HostedRecoverySnapshot>(recoveryPath);
  const recoveryAge = ageSeconds(recoveryReport?.generatedAt, nowMs);
  const recovery = {
    path: recoveryPath,
    present: Boolean(recoveryReport),
    sha256: recoveryPath ? sha256File(recoveryPath) : null,
    ageSeconds: recoveryAge,
    readiness: recoveryReport?.readiness ?? null,
    recommendedAction: recoveryReport?.recommendedAction ?? null,
    destinationHashMatches: destinationHash && recoveryReport ? recoveryReport.destinationMessageHash === destinationHash : null,
    spentNullifierPda: recoveryReport?.spentNullifier?.spentNullifierPda ?? null,
    spentNullifierExists: recoveryReport?.spentNullifier?.exists ?? null,
    withdrawAlreadyConsumed: recoveryReport?.spentNullifier?.withdrawAlreadyConsumed ?? null,
    ok: Boolean(
      recoveryReport &&
        recoveryReport.destinationMessageHash === destinationHash &&
        (recoveryReport.readiness === "ready_for_resume" ||
          recoveryReport.readiness === "already_withdrawn_spent_nullifier")
    ),
  };
  const jobRead = latestJob(destinationHash, env);
  const job = {
    indexPath: jobRead.indexPath,
    latestStatus: jobRead.job?.status ?? null,
    latestPhase: jobRead.job?.status ?? null,
    preflightHash: jobRead.job?.preflightReportSha256 ?? null,
    recoveryHash: jobRead.job?.recoverySnapshotSha256 ?? null,
    settlementTx: jobRead.job?.settlementTx ?? null,
    withdrawTx: jobRead.job?.withdrawTx ?? null,
    resultReportPath: jobRead.job?.resultReportPath ?? null,
    ok: Boolean(jobRead.job && (jobRead.job.status === "dry_run_ready" || jobRead.job.status === "succeeded")),
  };
  const defaultResultPath = destinationHash ? reportPath("settle-withdraw", destinationHash, env) : null;
  const resultPath = jobRead.job?.resultReportPath || defaultResultPath;
  const resultReport = {
    path: resultPath,
    present: Boolean(resultPath && fs.existsSync(resultPath)),
    sha256: resultPath ? sha256File(resultPath) : null,
  };
  const final = determineReadiness({
    safeOk: safeMode.ok,
    zkeysOk: zkeys.ok,
    noteOk: noteState.ok,
    preflightPresent: preflight.present,
    preflightOk: preflight.ok,
    preflightAge,
    recoveryPresent: recovery.present,
    recoveryOk: recovery.ok,
    recoveryAge,
    recoveryReadiness: recovery.readiness,
    leafOk: leafIndex.ok,
    latestJob: jobRead.job,
    maxAge,
  });
  const status: HostedOperatorStatus = {
    ok: final.readiness === "ready_for_dry_run_job" || final.readiness === "ready_for_execute" || final.readiness === "already_complete",
    generatedAt,
    destinationMessageHash: destinationHash,
    sourceMessageHash: sourceHash,
    safeMode,
    zkeys,
    noteState,
    preflight,
    recovery,
    leafIndex,
    job,
    resultReport,
    final,
    reportPath: null,
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
  };
  ensureNoSecretsRendered(status);
  if (input.writeReport !== false && destinationHash) {
    const outputPath = reportPath("operator-status", destinationHash, env);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
    status.reportPath = outputPath;
    fs.writeFileSync(outputPath, JSON.stringify(status, null, 2), { mode: 0o600 });
  }
  return status;
}

async function main(): Promise<void> {
  const status = buildOperatorStatus();
  console.log(JSON.stringify(status, null, 2));
  process.exit(status.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
