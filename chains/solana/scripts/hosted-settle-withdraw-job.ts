/**
 * Hosted operator job wrapper for Base -> Solana settlement/withdraw.
 *
 * Default mode is dry-run/check-only. The mutating verifier is only invoked
 * when BRIDGE_SETTLE_WITHDRAW_EXECUTE=true and a fresh PR-012G preflight
 * report passes every gate.
 */

import { spawnSync } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import type {
  HostedRecoverySnapshot,
  RecoverySnapshotReadiness,
  RecoverySnapshotRecommendedAction,
} from "./hosted-recovery-snapshot";
import type { HostedSettleWithdrawPreflight } from "./hosted-settle-withdraw-preflight";

const DEFAULT_RESULT_DIR = "/data/bridge-results";
const DEFAULT_JOB_INDEX_PATH = "/data/bridge-results/operator-job-index.json";
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;
const DEFAULT_RECOVERY_SNAPSHOT_MAX_AGE_SECONDS = 15 * 60;

type Readiness =
  | "ready"
  | "blocked_missing_report"
  | "blocked_stale_report"
  | "blocked_destination_mismatch"
  | "blocked_readiness"
  | "blocked_artifacts"
  | "blocked_note_state"
  | "blocked_pending"
  | "blocked_fifo"
  | "blocked_wallet"
  | "blocked_safe_mode"
  | "blocked_missing_env"
  | "blocked_preflight_hash"
  | "blocked_recovery_snapshot_missing"
  | "blocked_recovery_snapshot_stale"
  | "blocked_recovery_snapshot_mismatch"
  | "blocked_recovery_snapshot_hash"
  | "blocked_recovery_snapshot_readiness"
  | "blocked_recovery_snapshot_action"
  | "blocked_duplicate_execution"
  | "failed_execute";

type JobEntryStatus =
  | "created"
  | "preflight_bound"
  | "dry_run_ready"
  | "executing"
  | "settlement_submitted"
  | "settlement_confirmed"
  | "withdraw_submitted"
  | "withdraw_confirmed"
  | "duplicate_withdraw_checked"
  | "succeeded"
  | "failed"
  | "blocked"
  | "recovery_required";

export type JobGateResult = {
  ok: boolean;
  readiness: Readiness;
  errors: string[];
  reportPath: string | null;
  preflightReportSha256: string | null;
  destinationHash: string | null;
  sourceHash: string | null;
  preflightAgeSeconds: number | null;
  maxAgeSeconds: number;
  execute: boolean;
  wouldExecute: boolean;
  transactionsSubmittedByWrapper: false;
};

export type JobResult = JobGateResult & {
  jobId: string | null;
  jobIndexPath: string;
  status: "dry_run_ready" | "executed" | "blocked" | "failed" | "recovery_ready";
  resultPath: string | null;
  recoverySnapshotPath?: string | null;
  recoverySnapshotSha256?: string | null;
  recoveryReportPath?: string | null;
  recovery?: RecoveryReport;
  verifyResult?: Record<string, unknown>;
  secretsPrinted: false;
};

export type OperatorJobEntry = {
  jobId: string;
  jobType: "settle_withdraw";
  route: string | null;
  destinationMessageHash: string | null;
  sourceMessageHash: string | null;
  destinationCommitment: string | null;
  preflightReportPath: string | null;
  preflightReportSha256: string | null;
  preflightCreatedAt: string | null;
  preflightMaxAgeSeconds: number;
  recoverySnapshotPath?: string | null;
  recoverySnapshotSha256?: string | null;
  recoverySnapshotCreatedAt?: string | null;
  recoverySnapshotReadiness?: string | null;
  recoverySnapshotRecommendedAction?: string | null;
  noteStatePath: string | null;
  noteStateSha256: string | null;
  zkeyHashes: {
    merkleBatchUpdate: string | null;
    withdraw: string | null;
  };
  fifoPlan: {
    status: string | null;
    targetPendingIndex: number | null;
    pendingCount: number | null;
    fifoPrefixRequired: boolean | null;
    fifoPrefixCount: number | null;
    nextLeafIndex: number | null;
    currentMerkleRoot: string | null;
  };
  walletPublicKey: string | null;
  poolAuthorityExpected: string | null;
  poolAuthorityMatched: boolean | null;
  mode: "dry-run" | "execute";
  executeRequested: boolean;
  status: JobEntryStatus;
  settlementTx: string | null;
  withdrawTx: string | null;
  duplicateWithdrawResult: boolean | null;
  resultReportPath: string | null;
  recoveryReportPath: string | null;
  createdAt: string;
  updatedAt: string;
  errorCode: string | null;
  errorSummary: string | null;
};

export type OperatorJobIndex = {
  version: 1;
  jobs: OperatorJobEntry[];
};

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

type Executor = (input: {
  env: NodeJS.ProcessEnv;
  cwd: string;
}) => { status: number | null; stdout: string; stderr: string; error?: Error };

export type RecoverySnapshot = {
  checked: boolean;
  consumedPdaExists: boolean | null;
  commitmentIndexExists: boolean | null;
  targetPending: boolean | null;
  targetAlreadySettled: boolean | null;
  targetPendingIndex: number | null;
  pendingCount: number | null;
  fifoPrefixRequired: boolean | null;
  spentNullifierExists: boolean | null;
  settlementTxStatus: "confirmed" | "failed" | "not_found" | "unknown" | null;
  withdrawTxStatus: "confirmed" | "failed" | "not_found" | "unknown" | null;
  inferredPhase: JobEntryStatus;
  ambiguous: boolean;
  errors: string[];
};

export type RecoveryReport = {
  destinationHash: string | null;
  jobId: string | null;
  previousPhase: JobEntryStatus | null;
  inferredOnChainPhase: JobEntryStatus;
  actionTaken: string;
  txHashesChecked: {
    settlementTx: string | null;
    withdrawTx: string | null;
  };
  phaseAfterRecovery: JobEntryStatus;
  snapshot: RecoverySnapshot;
  secretsPrinted: false;
};

type RecoveryChecker = (input: {
  report: HostedSettleWithdrawPreflight;
  job: OperatorJobEntry | null;
}) => Promise<RecoverySnapshot> | RecoverySnapshot;

type RecoverySnapshotGate = {
  ok: boolean;
  readiness: Readiness;
  errors: string[];
  path: string | null;
  sha256: string | null;
  createdAt: string | null;
  ageSeconds: number | null;
  maxAgeSeconds: number;
  snapshot: HostedRecoverySnapshot | null;
  recommendedAction: RecoverySnapshotRecommendedAction | null;
  snapshotReadiness: RecoverySnapshotReadiness | null;
};

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function defaultResultDir(env: Env): string {
  return path.resolve(env.BRIDGE_RESULTS_DIR || env.PR012G_PREFLIGHT_RESULT_DIR || DEFAULT_RESULT_DIR);
}

export function jobIndexPathFor(env: Env = process.env): string {
  return path.resolve(env.BRIDGE_OPERATOR_JOB_INDEX_PATH || DEFAULT_JOB_INDEX_PATH);
}

function reportPathFor(destinationHash: string, env: Env): string {
  if (env.BRIDGE_PREFLIGHT_REPORT_PATH) return path.resolve(env.BRIDGE_PREFLIGHT_REPORT_PATH);
  return path.join(defaultResultDir(env), `preflight-${destinationHash.slice(2)}.json`);
}

function resultPathFor(destinationHash: string, env: Env): string {
  return path.join(defaultResultDir(env), `settle-withdraw-${destinationHash.slice(2)}.json`);
}

function recoveryPathFor(destinationHash: string, env: Env): string {
  return path.join(defaultResultDir(env), `recovery-${destinationHash.slice(2)}.json`);
}

function recoverySnapshotPathFor(destinationHash: string, env: Env): string {
  if (env.BRIDGE_RECOVERY_SNAPSHOT_PATH) return path.resolve(env.BRIDGE_RECOVERY_SNAPSHOT_PATH);
  return path.join(defaultResultDir(env), `recovery-snapshot-${destinationHash.slice(2)}.json`);
}

function sha256File(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function isTmpPath(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  return resolved === "/tmp" || resolved.startsWith("/tmp/");
}

function readReport(reportPath: string): HostedSettleWithdrawPreflight {
  return JSON.parse(fs.readFileSync(reportPath, "utf8")) as HostedSettleWithdrawPreflight;
}

function readRecoverySnapshot(snapshotPath: string): HostedRecoverySnapshot {
  return JSON.parse(fs.readFileSync(snapshotPath, "utf8")) as HostedRecoverySnapshot;
}

function readJobIndex(indexPath: string): OperatorJobIndex {
  if (!fs.existsSync(indexPath)) return { version: 1, jobs: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Partial<OperatorJobIndex>;
    if (parsed.version !== 1 || !Array.isArray(parsed.jobs)) return { version: 1, jobs: [] };
    return { version: 1, jobs: parsed.jobs };
  } catch {
    return { version: 1, jobs: [] };
  }
}

function writeJobIndexAtomic(indexPath: string, index: OperatorJobIndex): void {
  fs.mkdirSync(path.dirname(indexPath), { recursive: true, mode: 0o700 });
  const tmpPath = `${indexPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(index, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, indexPath);
}

function jobIdFor(destinationHash: string | null, preflightSha256: string | null): string | null {
  if (!destinationHash || !preflightSha256) return null;
  return `settle_withdraw:${destinationHash.slice(2)}:${preflightSha256.slice(0, 16)}`;
}

function recoverySnapshotAgeSeconds(snapshot: HostedRecoverySnapshot, nowMs: number): number | null {
  const timestamp = Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((nowMs - timestamp) / 1000));
}

function isBlockedRecoveryReadiness(readiness: RecoverySnapshotReadiness | null): boolean {
  return (
    readiness === "blocked_note_state_missing" ||
    readiness === "blocked_note_state_invalid" ||
    readiness === "blocked_spent_nullifier_unknown" ||
    readiness === "blocked_preflight_missing" ||
    readiness === "blocked_preflight_stale" ||
    readiness === "blocked_destination_hash_mismatch" ||
    readiness === "blocked_pending_not_found" ||
    readiness === "blocked_ambiguous_state" ||
    readiness === "tx_failed" ||
    readiness === "tx_unknown"
  );
}

function recoveryActionPermitted(input: {
  action: RecoverySnapshotRecommendedAction | null;
  readiness: RecoverySnapshotReadiness | null;
  resume: boolean;
  existingJob: OperatorJobEntry | null;
}): boolean {
  if (input.action === "no_action_already_complete") {
    return input.readiness === "already_withdrawn_spent_nullifier";
  }
  if (input.action === "resume_withdraw") {
    return (
      input.resume &&
      (
        input.readiness === "already_settled_pending_missing" ||
        input.readiness === "ready_for_resume" ||
        input.existingJob?.status === "settlement_confirmed" ||
        input.existingJob?.status === "withdraw_submitted"
      )
    );
  }
  if (input.action === "resume_settlement" || input.action === "settle_fifo_prefix") {
    return input.readiness === "ready_for_resume";
  }
  return false;
}

function safeErrorSummary(errors: string[]): { errorCode: string | null; errorSummary: string | null } {
  if (errors.length === 0) return { errorCode: null, errorSummary: null };
  return {
    errorCode: errors[0].split(":")[0] || "blocked",
    errorSummary: errors.map((error) => error.split(":")[0]).join(","),
  };
}

function jobEntryFromReport(input: {
  gates: JobGateResult;
  report: HostedSettleWithdrawPreflight | null;
  status: JobEntryStatus;
  resultPath?: string | null;
  verifyResult?: Record<string, unknown>;
  recoverySnapshotGate?: RecoverySnapshotGate | null;
  nowIso: string;
  existing?: OperatorJobEntry;
}): OperatorJobEntry | null {
  const jobId = jobIdFor(input.gates.destinationHash, input.gates.preflightReportSha256);
  if (!jobId) return null;
  const report = input.report;
  const evidence = (input.verifyResult?.evidence || {}) as Record<string, unknown>;
  const errors = safeErrorSummary(input.gates.errors);
  return {
    jobId,
    jobType: "settle_withdraw",
    route: report?.route || null,
    destinationMessageHash: input.gates.destinationHash,
    sourceMessageHash: input.gates.sourceHash,
    destinationCommitment: report?.destinationCommitment || null,
    preflightReportPath: input.gates.reportPath,
    preflightReportSha256: input.gates.preflightReportSha256,
    preflightCreatedAt: report?.generatedAt || null,
    preflightMaxAgeSeconds: input.gates.maxAgeSeconds,
    recoverySnapshotPath: input.recoverySnapshotGate?.path || input.existing?.recoverySnapshotPath || null,
    recoverySnapshotSha256: input.recoverySnapshotGate?.sha256 || input.existing?.recoverySnapshotSha256 || null,
    recoverySnapshotCreatedAt: input.recoverySnapshotGate?.createdAt || input.existing?.recoverySnapshotCreatedAt || null,
    recoverySnapshotReadiness: input.recoverySnapshotGate?.snapshotReadiness || input.existing?.recoverySnapshotReadiness || null,
    recoverySnapshotRecommendedAction:
      input.recoverySnapshotGate?.recommendedAction || input.existing?.recoverySnapshotRecommendedAction || null,
    noteStatePath: report?.noteState?.statePath || null,
    noteStateSha256: null,
    zkeyHashes: {
      merkleBatchUpdate: report?.artifacts?.merkleZkey?.sha256 || null,
      withdraw: report?.artifacts?.withdrawZkey?.sha256 || null,
    },
    fifoPlan: {
      status: report?.pending?.status || null,
      targetPendingIndex: report?.pending?.targetPendingIndex ?? null,
      pendingCount: report?.pending?.pendingCount ?? null,
      fifoPrefixRequired: report?.pending?.fifoPrefixRequired ?? null,
      fifoPrefixCount: report?.pending?.fifoPrefixCount ?? null,
      nextLeafIndex: report?.pending?.nextLeafIndex ?? null,
      currentMerkleRoot: report?.pending?.currentMerkleRoot || null,
    },
    walletPublicKey: report?.wallet?.walletPublicKey || null,
    poolAuthorityExpected: report?.wallet?.expectedPoolAuthority || null,
    poolAuthorityMatched: report?.wallet?.poolAuthorityMatches ?? null,
    mode: input.gates.execute ? "execute" : "dry-run",
    executeRequested: input.gates.execute,
    status: input.status,
    settlementTx: typeof evidence.settleTx === "string" ? evidence.settleTx : input.existing?.settlementTx || null,
    withdrawTx: typeof evidence.withdrawTx === "string" ? evidence.withdrawTx : input.existing?.withdrawTx || null,
    duplicateWithdrawResult:
      typeof evidence.duplicateWithdrawRejected === "boolean"
        ? evidence.duplicateWithdrawRejected
        : input.existing?.duplicateWithdrawResult ?? null,
    resultReportPath: input.resultPath || input.existing?.resultReportPath || null,
    recoveryReportPath: input.existing?.recoveryReportPath || null,
    createdAt: input.existing?.createdAt || input.nowIso,
    updatedAt: input.nowIso,
    errorCode: errors.errorCode,
    errorSummary: errors.errorSummary,
  };
}

function upsertJobEntry(indexPath: string, entry: OperatorJobEntry): void {
  const index = readJobIndex(indexPath);
  const existingIndex = index.jobs.findIndex((job) => job.jobId === entry.jobId);
  if (existingIndex >= 0) index.jobs[existingIndex] = entry;
  else index.jobs.push(entry);
  writeJobIndexAtomic(indexPath, index);
}

function successfulJobForDestination(indexPath: string, destinationHash: string): OperatorJobEntry | null {
  const index = readJobIndex(indexPath);
  return (
    index.jobs.find(
      (job) => job.destinationMessageHash?.toLowerCase() === destinationHash.toLowerCase() && job.status === "succeeded"
    ) || null
  );
}

function latestJobForDestination(indexPath: string, destinationHash: string): OperatorJobEntry | null {
  const index = readJobIndex(indexPath);
  return (
    [...index.jobs]
      .reverse()
      .find((job) => job.destinationMessageHash?.toLowerCase() === destinationHash.toLowerCase()) || null
  );
}

function defaultRecoverySnapshot(input: {
  report: HostedSettleWithdrawPreflight;
  job: OperatorJobEntry | null;
}): RecoverySnapshot {
  const pending = input.report.pending;
  const job = input.job;
  const spentNullifierExists = job?.status === "withdraw_confirmed" || job?.status === "duplicate_withdraw_checked" || job?.status === "succeeded";
  let inferredPhase: JobEntryStatus = "preflight_bound";
  if (spentNullifierExists) inferredPhase = job?.duplicateWithdrawResult ? "duplicate_withdraw_checked" : "withdraw_confirmed";
  else if (pending.targetAlreadySettled || job?.status === "settlement_confirmed") inferredPhase = "settlement_confirmed";
  else if (pending.targetPending) inferredPhase = "preflight_bound";
  const ambiguous =
    Boolean(job?.settlementTx && job.status === "settlement_submitted" && pending.targetPending) ||
    Boolean(job?.withdrawTx && job.status === "withdraw_submitted" && !spentNullifierExists);
  return {
    checked: true,
    consumedPdaExists: pending.consumedPdaExists,
    commitmentIndexExists: pending.targetAlreadySettled,
    targetPending: pending.targetPending,
    targetAlreadySettled: pending.targetAlreadySettled,
    targetPendingIndex: pending.targetPendingIndex,
    pendingCount: pending.pendingCount,
    fifoPrefixRequired: pending.fifoPrefixRequired,
    spentNullifierExists,
    settlementTxStatus: job?.settlementTx ? (pending.targetAlreadySettled ? "confirmed" : "unknown") : null,
    withdrawTxStatus: job?.withdrawTx ? (spentNullifierExists ? "confirmed" : "unknown") : null,
    inferredPhase,
    ambiguous,
    errors: ambiguous ? ["recovery_state_ambiguous"] : [],
  };
}

function writeRecoveryReport(input: {
  destinationHash: string;
  env: Env;
  jobId: string | null;
  previousPhase: JobEntryStatus | null;
  snapshot: RecoverySnapshot;
  actionTaken: string;
  phaseAfterRecovery: JobEntryStatus;
  existingJob: OperatorJobEntry | null;
}): { path: string; report: RecoveryReport } {
  const recoveryPath = recoveryPathFor(input.destinationHash, input.env);
  const report: RecoveryReport = {
    destinationHash: input.destinationHash,
    jobId: input.jobId,
    previousPhase: input.previousPhase,
    inferredOnChainPhase: input.snapshot.inferredPhase,
    actionTaken: input.actionTaken,
    txHashesChecked: {
      settlementTx: input.existingJob?.settlementTx || null,
      withdrawTx: input.existingJob?.withdrawTx || null,
    },
    phaseAfterRecovery: input.phaseAfterRecovery,
    snapshot: input.snapshot,
    secretsPrinted: false,
  };
  ensureNoSecretsRendered(report);
  fs.mkdirSync(path.dirname(recoveryPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(recoveryPath, JSON.stringify(report, null, 2), { mode: 0o600 });
  return { path: recoveryPath, report };
}

function reportAgeSeconds(report: HostedSettleWithdrawPreflight, nowMs: number): number | null {
  const timestamp = Date.parse(report.generatedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((nowMs - timestamp) / 1000));
}

function hasRequiredArtifactChecks(report: HostedSettleWithdrawPreflight): boolean {
  return Boolean(
    report.artifacts?.ok &&
      report.artifacts.merkleZkey?.exists &&
      report.artifacts.merkleZkey?.hashMatches &&
      report.artifacts.merkleZkey?.underPersistentDir &&
      report.artifacts.withdrawZkey?.exists &&
      report.artifacts.withdrawZkey?.hashMatches &&
      report.artifacts.withdrawZkey?.underPersistentDir &&
      report.artifacts.merkleWasm?.exists &&
      report.artifacts.withdrawWasm?.exists
  );
}

function hasRequiredNoteStateChecks(report: HostedSettleWithdrawPreflight): boolean {
  return Boolean(
    report.noteState?.ok &&
      report.noteState.checks?.backupDirSet &&
      report.noteState.checks?.backupDirExists &&
      report.noteState.checks?.backupDirNotTmp &&
      report.noteState.checks?.backupDirOutsideRepo &&
      report.noteState.checks?.stateFileExists &&
      report.noteState.checks?.sourceHash &&
      report.noteState.checks?.destinationHash &&
      report.noteState.checks?.destinationCommitment &&
      report.noteState.checks?.amount &&
      report.noteState.checks?.asset &&
      report.noteState.summary?.hasDestSecret &&
      report.noteState.summary?.hasDestNullifier &&
      report.noteState.statePath &&
      !isTmpPath(report.noteState.statePath)
  );
}

function hasRequiredPendingChecks(report: HostedSettleWithdrawPreflight): boolean {
  return Boolean(
    report.pending?.ok &&
      (report.pending.status === "ready" || report.pending.status === "already_settled") &&
      (report.pending.targetPending === true || report.pending.targetAlreadySettled === true) &&
      report.pending.fifoPrefixRequired !== true &&
      report.pending.consumedPdaExists === true
  );
}

function hasRequiredWalletChecks(report: HostedSettleWithdrawPreflight): boolean {
  return Boolean(report.wallet?.ok && report.wallet.poolAuthorityMatches === true && report.wallet.walletPublicKey);
}

function requiredEnvMissing(env: Env): string[] {
  const required = ["BRIDGE_DAEMON_MODE", "BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT"];
  return required.filter((name) => !env[name]);
}

export function validatePreflightForJob(input: {
  env?: Env;
  nowMs?: number;
} = {}): { gates: JobGateResult; report: HostedSettleWithdrawPreflight | null } {
  const env = input.env || process.env;
  const nowMs = input.nowMs ?? Date.now();
  const destinationHash = normalizeHash(env.PR012B_DESTINATION_MESSAGE_HASH || env.BRIDGE_DESTINATION_MESSAGE_HASH);
  const maxAgeSeconds = Number(env.BRIDGE_PREFLIGHT_MAX_AGE_SECONDS || DEFAULT_MAX_AGE_SECONDS);
  const execute = env.BRIDGE_SETTLE_WITHDRAW_EXECUTE === "true";
  const expectedPreflightSha256 = env.BRIDGE_EXPECTED_PREFLIGHT_SHA256?.trim().toLowerCase();
  const errors: string[] = [];

  if (!destinationHash) errors.push("destination_hash_missing");
  const missingEnv = requiredEnvMissing(env);
  for (const name of missingEnv) errors.push(`missing_env:${name}`);
  if (env.BRIDGE_DAEMON_MODE !== "paper") errors.push("bridge_daemon_mode_must_be_paper");
  if (env.BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT !== "false") errors.push("live_testnet_submit_must_be_false");

  const reportPath = destinationHash ? reportPathFor(destinationHash, env) : null;
  let report: HostedSettleWithdrawPreflight | null = null;
  let preflightReportSha256: string | null = null;
  let preflightAgeSeconds: number | null = null;
  if (!reportPath || !fs.existsSync(reportPath)) {
    errors.push("preflight_report_missing");
  } else {
    preflightReportSha256 = sha256File(reportPath);
    if (expectedPreflightSha256 && preflightReportSha256 !== expectedPreflightSha256) {
      errors.push("preflight_sha256_mismatch");
    }
    report = readReport(reportPath);
    preflightAgeSeconds = reportAgeSeconds(report, nowMs);
    if (preflightAgeSeconds === null || preflightAgeSeconds > maxAgeSeconds) errors.push("preflight_report_stale");
    if (destinationHash && report.destinationBridgeMintHash?.toLowerCase() !== destinationHash) {
      errors.push("preflight_destination_hash_mismatch");
    }
    if (report.readiness !== "ready") errors.push(`preflight_readiness_not_ready:${report.readiness}`);
    if (!hasRequiredArtifactChecks(report)) errors.push("artifact_gate_failed");
    if (!hasRequiredNoteStateChecks(report)) errors.push("note_state_gate_failed");
    if (!hasRequiredPendingChecks(report)) errors.push("pending_or_fifo_gate_failed");
    if (!hasRequiredWalletChecks(report)) errors.push("wallet_authority_gate_failed");
    if (report.transactionsSubmitted !== false) errors.push("preflight_report_claims_transaction_submission");
    if (report.secretsPrinted !== false) errors.push("preflight_report_claims_secret_output");
  }

  let readiness: Readiness = "ready";
  if (errors.includes("preflight_report_missing")) readiness = "blocked_missing_report";
  else if (errors.includes("preflight_sha256_mismatch")) readiness = "blocked_preflight_hash";
  else if (errors.includes("preflight_report_stale")) readiness = "blocked_stale_report";
  else if (errors.includes("preflight_destination_hash_mismatch")) readiness = "blocked_destination_mismatch";
  else if (errors.some((e) => e.startsWith("preflight_readiness_not_ready"))) {
    readiness = report?.readiness === "blocked_fifo" ? "blocked_fifo" : "blocked_readiness";
  } else if (errors.includes("artifact_gate_failed")) readiness = "blocked_artifacts";
  else if (errors.includes("note_state_gate_failed")) readiness = "blocked_note_state";
  else if (errors.includes("pending_or_fifo_gate_failed")) readiness = report?.pending?.status === "requires_fifo_prefix" ? "blocked_fifo" : "blocked_pending";
  else if (errors.includes("wallet_authority_gate_failed")) readiness = "blocked_wallet";
  else if (errors.includes("bridge_daemon_mode_must_be_paper") || errors.includes("live_testnet_submit_must_be_false")) {
    readiness = "blocked_safe_mode";
  } else if (errors.some((e) => e.startsWith("missing_env")) || errors.includes("destination_hash_missing")) {
    readiness = "blocked_missing_env";
  }

  return {
    report,
    gates: {
      ok: errors.length === 0,
      readiness,
      errors,
      reportPath,
      preflightReportSha256,
      destinationHash,
      sourceHash: report?.sourceBridgeOutHash || null,
      preflightAgeSeconds,
      maxAgeSeconds,
      execute,
      wouldExecute: errors.length === 0 && execute,
      transactionsSubmittedByWrapper: false,
    },
  };
}

export function validateRecoverySnapshotForJob(input: {
  env?: Env;
  nowMs?: number;
  destinationHash: string | null;
  sourceHash: string | null;
  resume?: boolean;
  existingJob?: OperatorJobEntry | null;
}): RecoverySnapshotGate {
  const env = input.env || process.env;
  const nowMs = input.nowMs ?? Date.now();
  const maxAgeSeconds = Number(env.BRIDGE_RECOVERY_SNAPSHOT_MAX_AGE_SECONDS || DEFAULT_RECOVERY_SNAPSHOT_MAX_AGE_SECONDS);
  const expectedSnapshotSha256 = env.BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256?.trim().toLowerCase();
  const errors: string[] = [];
  let snapshot: HostedRecoverySnapshot | null = null;
  let sha256: string | null = null;
  let createdAt: string | null = null;
  let ageSeconds: number | null = null;
  let recommendedAction: RecoverySnapshotRecommendedAction | null = null;
  let snapshotReadiness: RecoverySnapshotReadiness | null = null;

  const snapshotPath = input.destinationHash ? recoverySnapshotPathFor(input.destinationHash, env) : null;
  if (!snapshotPath || !fs.existsSync(snapshotPath)) {
    errors.push("recovery_snapshot_missing");
  } else {
    sha256 = sha256File(snapshotPath);
    if (expectedSnapshotSha256 && sha256 !== expectedSnapshotSha256) {
      errors.push("recovery_snapshot_sha256_mismatch");
    }
    snapshot = readRecoverySnapshot(snapshotPath);
    createdAt = snapshot.generatedAt || null;
    ageSeconds = recoverySnapshotAgeSeconds(snapshot, nowMs);
    recommendedAction = snapshot.recommendedAction;
    snapshotReadiness = snapshot.readiness;
    if (ageSeconds === null || ageSeconds > maxAgeSeconds) errors.push("recovery_snapshot_stale");
    if (input.destinationHash && snapshot.destinationMessageHash?.toLowerCase() !== input.destinationHash) {
      errors.push("recovery_snapshot_destination_hash_mismatch");
    }
    if (input.sourceHash && snapshot.sourceMessageHash && snapshot.sourceMessageHash.toLowerCase() !== input.sourceHash) {
      errors.push("recovery_snapshot_source_hash_mismatch");
    }
    if (input.sourceHash && !snapshot.sourceMessageHash) {
      errors.push("recovery_snapshot_source_hash_missing");
    }
    if (isBlockedRecoveryReadiness(snapshot.readiness)) {
      errors.push(`recovery_snapshot_readiness_blocked:${snapshot.readiness}`);
    }
    const spentNullifier = (snapshot as any).spentNullifier;
    if (!spentNullifier || spentNullifier.derived !== true || !spentNullifier.spentNullifierPda) {
      errors.push("recovery_snapshot_spent_nullifier_not_derived");
    }
    if (spentNullifier?.exists === true && snapshot.recommendedAction !== "no_action_already_complete") {
      errors.push("recovery_snapshot_spent_nullifier_exists_without_noop");
    }
    if (snapshot.recommendedAction === "no_action_already_complete" && spentNullifier?.withdrawAlreadyConsumed !== true) {
      errors.push("recovery_snapshot_noop_without_spent_nullifier");
    }
    if (!recoveryActionPermitted({
      action: snapshot.recommendedAction,
      readiness: snapshot.readiness,
      resume: input.resume === true,
      existingJob: input.existingJob || null,
    })) {
      errors.push(`recovery_snapshot_recommended_action_not_permitted:${snapshot.recommendedAction}`);
    }
    if (snapshot.transactionsSubmitted !== false) errors.push("recovery_snapshot_claims_transaction_submission");
    if (snapshot.proofsGenerated !== false) errors.push("recovery_snapshot_claims_proof_generation");
    if (snapshot.secretsPrinted !== false) errors.push("recovery_snapshot_claims_secret_output");
  }

  let readiness: Readiness = "ready";
  if (errors.includes("recovery_snapshot_missing")) readiness = "blocked_recovery_snapshot_missing";
  else if (errors.includes("recovery_snapshot_sha256_mismatch")) readiness = "blocked_recovery_snapshot_hash";
  else if (errors.includes("recovery_snapshot_stale")) readiness = "blocked_recovery_snapshot_stale";
  else if (
    errors.includes("recovery_snapshot_destination_hash_mismatch") ||
    errors.includes("recovery_snapshot_source_hash_mismatch") ||
    errors.includes("recovery_snapshot_source_hash_missing")
  ) {
    readiness = "blocked_recovery_snapshot_mismatch";
  } else if (errors.some((error) => error.startsWith("recovery_snapshot_readiness_blocked"))) {
    readiness = "blocked_recovery_snapshot_readiness";
  } else if (
    errors.some((error) => error.startsWith("recovery_snapshot_recommended_action_not_permitted")) ||
    errors.includes("recovery_snapshot_spent_nullifier_not_derived") ||
    errors.includes("recovery_snapshot_spent_nullifier_exists_without_noop") ||
    errors.includes("recovery_snapshot_noop_without_spent_nullifier") ||
    errors.includes("recovery_snapshot_claims_transaction_submission") ||
    errors.includes("recovery_snapshot_claims_proof_generation") ||
    errors.includes("recovery_snapshot_claims_secret_output")
  ) {
    readiness = "blocked_recovery_snapshot_action";
  }

  return {
    ok: errors.length === 0,
    readiness,
    errors,
    path: snapshotPath,
    sha256,
    createdAt,
    ageSeconds,
    maxAgeSeconds,
    snapshot,
    recommendedAction,
    snapshotReadiness,
  };
}

function defaultExecutor(input: { env: NodeJS.ProcessEnv; cwd: string }): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const result = spawnSync("npx", ["tsx", "scripts/verify-daemon-mint-settle-withdraw.ts"], {
    cwd: input.cwd,
    env: input.env,
    encoding: "utf8",
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function shouldBindRecoverySnapshotDuringDryRun(input: {
  env: Env;
  destinationHash: string;
}): boolean {
  if (input.env.BRIDGE_REQUIRE_RECOVERY_SNAPSHOT_DRY_RUN === "true") return true;
  if (input.env.BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256?.trim()) return true;
  const snapshotPath = recoverySnapshotPathFor(input.destinationHash, input.env);
  return fs.existsSync(snapshotPath);
}

function sanitizeVerifyResult(value: any): Record<string, unknown> {
  const evidence = value?.evidence || {};
  return {
    ok: value?.ok === true,
    status: value?.status || null,
    evidence: {
      sourceBridgeOutHash: evidence.sourceBridgeOutHash || null,
      destinationBridgeMintHash: evidence.destinationBridgeMintHash || null,
      destinationCommitment: evidence.destinationCommitment || null,
      submitTx: evidence.submitTx || null,
      fifoPrefixSettlementTxs: evidence.fifoPrefixSettlementTxs || [],
      fifoPrefixSettledCount: evidence.fifoPrefixSettledCount ?? null,
      settleTx: evidence.settleTx || null,
      withdrawTx: evidence.withdrawTx || null,
      duplicateWithdrawRejected: evidence.duplicateWithdrawRejected ?? null,
      oldRoot: evidence.oldRoot || null,
      newRoot: evidence.newRoot || null,
      merkleRootChanged: evidence.merkleRootChanged ?? null,
      nextLeafIndexBefore: evidence.nextLeafIndexBefore ?? null,
      nextLeafIndexAfter: evidence.nextLeafIndexAfter ?? null,
      pendingBefore: evidence.pendingBefore ?? null,
      pendingBeforeTargetSettle: evidence.pendingBeforeTargetSettle ?? null,
      pendingAfter: evidence.pendingAfter ?? null,
      recipientBeforeWithdraw: evidence.recipientBeforeWithdraw || null,
      recipientAfterWithdraw: evidence.recipientAfterWithdraw || null,
      vaultBeforeWithdraw: evidence.vaultBeforeWithdraw || null,
      vaultAfterWithdraw: evidence.vaultAfterWithdraw || null,
      spentNullifier: evidence.spentNullifier || null,
      additionalBridgeSubmitTx: evidence.additionalBridgeSubmitTx || null,
    },
  };
}

function ensureNoSecretsRendered(value: unknown): void {
  const rendered = JSON.stringify(value);
  for (const sentinel of ["destSecret", "destNullifier", "privateKey", "mnemonic", "seedPhrase", "witness"]) {
    if (rendered.includes(sentinel)) {
      throw new Error(`job_output_contains_sensitive_field:${sentinel}`);
    }
  }
}

export async function runSettleWithdrawJob(input: {
  env?: Env;
  nowMs?: number;
  executor?: Executor;
  recoveryChecker?: RecoveryChecker;
  cwd?: string;
  beforeExecute?: () => void;
} = {}): Promise<JobResult> {
  const env = input.env || process.env;
  const validation = validatePreflightForJob({ env, nowMs: input.nowMs });
  const jobIndexPath = jobIndexPathFor(env);
  const nowIso = new Date(input.nowMs ?? Date.now()).toISOString();
  const resume = env.BRIDGE_SETTLE_WITHDRAW_RESUME === "true";
  if (!validation.gates.ok) {
    const blocked: JobResult = {
      ...validation.gates,
      jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
      jobIndexPath,
      status: "blocked",
      resultPath: null,
      secretsPrinted: false,
    };
    const entry = jobEntryFromReport({
      gates: validation.gates,
      report: validation.report,
      status: "blocked",
      nowIso,
    });
    if (entry) upsertJobEntry(jobIndexPath, entry);
    ensureNoSecretsRendered(blocked);
    return blocked;
  }

  const destinationHash = validation.gates.destinationHash!;
  const existingJob = latestJobForDestination(jobIndexPath, destinationHash);
  const existingSuccessfulJob = successfulJobForDestination(jobIndexPath, destinationHash);
  let recoverySnapshotGate: RecoverySnapshotGate | null = null;

  if (!validation.gates.execute) {
    if (shouldBindRecoverySnapshotDuringDryRun({ env, destinationHash })) {
      recoverySnapshotGate = validateRecoverySnapshotForJob({
        env,
        nowMs: input.nowMs,
        destinationHash,
        sourceHash: validation.gates.sourceHash,
        resume,
        existingJob,
      });
      if (!recoverySnapshotGate.ok) {
        const snapshotGates: JobGateResult = {
          ...validation.gates,
          ok: false,
          readiness: recoverySnapshotGate.readiness,
          errors: [...validation.gates.errors, ...recoverySnapshotGate.errors],
          wouldExecute: false,
        };
        const blocked: JobResult = {
          ...snapshotGates,
          jobId: jobIdFor(snapshotGates.destinationHash, snapshotGates.preflightReportSha256),
          jobIndexPath,
          status: "blocked",
          resultPath: null,
          recoverySnapshotPath: recoverySnapshotGate.path,
          recoverySnapshotSha256: recoverySnapshotGate.sha256,
          secretsPrinted: false,
        };
        const entry = jobEntryFromReport({
          gates: snapshotGates,
          report: validation.report,
          status: "blocked",
          recoverySnapshotGate,
          nowIso,
          existing: existingJob || undefined,
        });
        if (entry) upsertJobEntry(jobIndexPath, entry);
        ensureNoSecretsRendered(blocked);
        return blocked;
      }
    }

    let recoveryResult: { path: string; report: RecoveryReport } | null = null;
    if (resume && validation.report) {
      const checker = input.recoveryChecker || defaultRecoverySnapshot;
      const snapshot = await checker({ report: validation.report, job: existingJob });
      recoveryResult = writeRecoveryReport({
        destinationHash,
        env,
        jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
        previousPhase: existingJob?.status || null,
        snapshot,
        actionTaken: snapshot.ambiguous ? "blocked_ambiguous_state" : "dry_run_recovery_check",
        phaseAfterRecovery: snapshot.ambiguous ? "recovery_required" : snapshot.inferredPhase,
        existingJob,
      });
    }
    const dryRun: JobResult = {
      ...validation.gates,
      jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
      jobIndexPath,
      status: resume ? "recovery_ready" : "dry_run_ready",
      resultPath: null,
      recoverySnapshotPath: recoverySnapshotGate?.path || null,
      recoverySnapshotSha256: recoverySnapshotGate?.sha256 || null,
      recoveryReportPath: recoveryResult?.path || null,
      recovery: recoveryResult?.report,
      secretsPrinted: false,
    };
    const entry = jobEntryFromReport({
      gates: validation.gates,
      report: validation.report,
      status: resume ? (recoveryResult?.report.phaseAfterRecovery || "recovery_required") : "dry_run_ready",
      nowIso,
      existing: existingJob || undefined,
      recoverySnapshotGate,
    });
    if (entry) {
      entry.recoveryReportPath = recoveryResult?.path || entry.recoveryReportPath;
      upsertJobEntry(jobIndexPath, entry);
    }
    ensureNoSecretsRendered(dryRun);
    return dryRun;
  }

  recoverySnapshotGate = validateRecoverySnapshotForJob({
    env,
    nowMs: input.nowMs,
    destinationHash,
    sourceHash: validation.gates.sourceHash,
    resume,
    existingJob,
  });
  if (!recoverySnapshotGate.ok) {
    const snapshotGates: JobGateResult = {
      ...validation.gates,
      ok: false,
      readiness: recoverySnapshotGate.readiness,
      errors: [...validation.gates.errors, ...recoverySnapshotGate.errors],
      wouldExecute: false,
    };
    const blocked: JobResult = {
      ...snapshotGates,
      jobId: jobIdFor(snapshotGates.destinationHash, snapshotGates.preflightReportSha256),
      jobIndexPath,
      status: "blocked",
      resultPath: null,
      recoverySnapshotPath: recoverySnapshotGate.path,
      recoverySnapshotSha256: recoverySnapshotGate.sha256,
      secretsPrinted: false,
    };
    const entry = jobEntryFromReport({
      gates: snapshotGates,
      report: validation.report,
      status: "blocked",
      recoverySnapshotGate,
      nowIso,
      existing: existingJob || undefined,
    });
    if (entry) upsertJobEntry(jobIndexPath, entry);
    ensureNoSecretsRendered(blocked);
    return blocked;
  }

  if (recoverySnapshotGate.recommendedAction === "no_action_already_complete") {
    const done: JobResult = {
      ...validation.gates,
      jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
      jobIndexPath,
      status: "executed",
      resultPath: existingJob?.resultReportPath || null,
      recoverySnapshotPath: recoverySnapshotGate.path,
      recoverySnapshotSha256: recoverySnapshotGate.sha256,
      secretsPrinted: false,
    };
    const entry = jobEntryFromReport({
      gates: validation.gates,
      report: validation.report,
      status: "succeeded",
      resultPath: existingJob?.resultReportPath || null,
      recoverySnapshotGate,
      nowIso,
      existing: existingJob || undefined,
    });
    if (entry) upsertJobEntry(jobIndexPath, entry);
    ensureNoSecretsRendered(done);
    return done;
  }

  if (existingSuccessfulJob && !resume) {
    const duplicateGates: JobGateResult = {
      ...validation.gates,
      ok: false,
      readiness: "blocked_duplicate_execution",
      errors: [...validation.gates.errors, "duplicate_execution_blocked"],
      wouldExecute: false,
    };
    const blocked: JobResult = {
      ...duplicateGates,
      jobId: jobIdFor(duplicateGates.destinationHash, duplicateGates.preflightReportSha256),
      jobIndexPath,
      status: "blocked",
      resultPath: null,
      recoverySnapshotPath: recoverySnapshotGate.path,
      recoverySnapshotSha256: recoverySnapshotGate.sha256,
      secretsPrinted: false,
    };
    const entry = jobEntryFromReport({
      gates: duplicateGates,
      report: validation.report,
      status: "blocked",
      recoverySnapshotGate,
      nowIso,
    });
    if (entry) upsertJobEntry(jobIndexPath, entry);
    ensureNoSecretsRendered(blocked);
    return blocked;
  }

  if (existingJob && existingJob.status !== "dry_run_ready" && existingJob.status !== "blocked" && !resume) {
    const partialGates: JobGateResult = {
      ...validation.gates,
      ok: false,
      readiness: "blocked_duplicate_execution",
      errors: [...validation.gates.errors, "partial_job_exists_resume_required"],
      wouldExecute: false,
    };
    const blocked: JobResult = {
      ...partialGates,
      jobId: jobIdFor(partialGates.destinationHash, partialGates.preflightReportSha256),
      jobIndexPath,
      status: "blocked",
      resultPath: null,
      recoverySnapshotPath: recoverySnapshotGate.path,
      recoverySnapshotSha256: recoverySnapshotGate.sha256,
      secretsPrinted: false,
    };
    const entry = jobEntryFromReport({
      gates: partialGates,
      report: validation.report,
      status: "blocked",
      recoverySnapshotGate,
      nowIso,
      existing: existingJob,
    });
    if (entry) upsertJobEntry(jobIndexPath, entry);
    ensureNoSecretsRendered(blocked);
    return blocked;
  }

  let recoveryResult: { path: string; report: RecoveryReport } | null = null;
  if (resume && validation.report) {
    const checker = input.recoveryChecker || defaultRecoverySnapshot;
    const snapshot = await checker({ report: validation.report, job: existingJob });
    const phaseAfterRecovery = snapshot.ambiguous ? "recovery_required" : snapshot.inferredPhase;
    recoveryResult = writeRecoveryReport({
      destinationHash,
      env,
      jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
      previousPhase: existingJob?.status || null,
      snapshot,
      actionTaken: snapshot.ambiguous ? "blocked_ambiguous_state" : "resume_recovery_check",
      phaseAfterRecovery,
      existingJob,
    });
    if (snapshot.ambiguous || snapshot.errors.length > 0) {
      const ambiguousGates: JobGateResult = {
        ...validation.gates,
        ok: false,
        readiness: "blocked_duplicate_execution",
        errors: [...validation.gates.errors, ...snapshot.errors, "ambiguous_recovery_state"],
        wouldExecute: false,
      };
      const blocked: JobResult = {
        ...ambiguousGates,
        jobId: jobIdFor(ambiguousGates.destinationHash, ambiguousGates.preflightReportSha256),
        jobIndexPath,
        status: "blocked",
        resultPath: null,
        recoverySnapshotPath: recoverySnapshotGate?.path || null,
        recoverySnapshotSha256: recoverySnapshotGate?.sha256 || null,
        recoveryReportPath: recoveryResult.path,
        recovery: recoveryResult.report,
        secretsPrinted: false,
      };
      const entry = jobEntryFromReport({
        gates: ambiguousGates,
        report: validation.report,
        status: "recovery_required",
        recoverySnapshotGate,
        nowIso,
        existing: existingJob || undefined,
      });
      if (entry) {
        entry.recoveryReportPath = recoveryResult.path;
        upsertJobEntry(jobIndexPath, entry);
      }
      ensureNoSecretsRendered(blocked);
      return blocked;
    }
    if (snapshot.inferredPhase === "duplicate_withdraw_checked" || snapshot.inferredPhase === "succeeded") {
      const done: JobResult = {
        ...validation.gates,
        jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
        jobIndexPath,
        status: "executed",
        resultPath: existingJob?.resultReportPath || null,
        recoverySnapshotPath: recoverySnapshotGate?.path || null,
        recoverySnapshotSha256: recoverySnapshotGate?.sha256 || null,
        recoveryReportPath: recoveryResult.path,
        recovery: recoveryResult.report,
        secretsPrinted: false,
      };
      const entry = jobEntryFromReport({
        gates: validation.gates,
        report: validation.report,
        status: "succeeded",
        resultPath: existingJob?.resultReportPath || null,
        recoverySnapshotGate,
        nowIso,
        existing: existingJob || undefined,
      });
      if (entry) {
        entry.recoveryReportPath = recoveryResult.path;
        upsertJobEntry(jobIndexPath, entry);
      }
      ensureNoSecretsRendered(done);
      return done;
    }
  }

  const executingEntry = jobEntryFromReport({
    gates: validation.gates,
    report: validation.report,
    status: resume && recoveryResult?.report.phaseAfterRecovery === "settlement_confirmed" ? "settlement_confirmed" : "executing",
    recoverySnapshotGate,
    nowIso,
    existing: existingJob || undefined,
  });
  if (executingEntry) {
    executingEntry.recoveryReportPath = recoveryResult?.path || executingEntry.recoveryReportPath;
    upsertJobEntry(jobIndexPath, executingEntry);
  }

  input.beforeExecute?.();
  if (validation.gates.reportPath && sha256File(validation.gates.reportPath) !== validation.gates.preflightReportSha256) {
    const changedGates: JobGateResult = {
      ...validation.gates,
      ok: false,
      readiness: "blocked_preflight_hash",
      errors: [...validation.gates.errors, "preflight_report_changed_after_binding"],
      wouldExecute: false,
    };
    const failed: JobResult = {
      ...changedGates,
      jobId: jobIdFor(changedGates.destinationHash, changedGates.preflightReportSha256),
      jobIndexPath,
      status: "blocked",
      resultPath: null,
      recoverySnapshotPath: recoverySnapshotGate?.path || null,
      recoverySnapshotSha256: recoverySnapshotGate?.sha256 || null,
      recoveryReportPath: recoveryResult?.path || null,
      recovery: recoveryResult?.report,
      secretsPrinted: false,
    };
    const failedEntry = jobEntryFromReport({
      gates: changedGates,
      report: validation.report,
      status: "blocked",
      recoverySnapshotGate,
      nowIso: new Date(Date.now()).toISOString(),
      existing: executingEntry || undefined,
    });
    if (failedEntry) upsertJobEntry(jobIndexPath, failedEntry);
    ensureNoSecretsRendered(failed);
    return failed;
  }
  if (recoverySnapshotGate?.path && recoverySnapshotGate.sha256 && sha256File(recoverySnapshotGate.path) !== recoverySnapshotGate.sha256) {
    const changedGates: JobGateResult = {
      ...validation.gates,
      ok: false,
      readiness: "blocked_recovery_snapshot_hash",
      errors: [...validation.gates.errors, "recovery_snapshot_changed_after_binding"],
      wouldExecute: false,
    };
    const failed: JobResult = {
      ...changedGates,
      jobId: jobIdFor(changedGates.destinationHash, changedGates.preflightReportSha256),
      jobIndexPath,
      status: "blocked",
      resultPath: null,
      recoverySnapshotPath: recoverySnapshotGate.path,
      recoverySnapshotSha256: recoverySnapshotGate.sha256,
      recoveryReportPath: recoveryResult?.path || null,
      recovery: recoveryResult?.report,
      secretsPrinted: false,
    };
    const failedEntry = jobEntryFromReport({
      gates: changedGates,
      report: validation.report,
      status: "blocked",
      recoverySnapshotGate,
      nowIso: new Date(Date.now()).toISOString(),
      existing: executingEntry || undefined,
    });
    if (failedEntry) upsertJobEntry(jobIndexPath, failedEntry);
    ensureNoSecretsRendered(failed);
    return failed;
  }

  const resultPath = resultPathFor(destinationHash, env);
  const rawResultPath = path.join(defaultResultDir(env), `settle-withdraw-raw-${destinationHash.slice(2)}.json`);
  fs.mkdirSync(path.dirname(resultPath), { recursive: true, mode: 0o700 });

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    BRIDGE_DAEMON_MODE: "paper",
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "false",
    PR012B_RESULT_PATH: rawResultPath,
  };
  if (resume && recoveryResult?.report.phaseAfterRecovery) {
    childEnv.PR012B_RESUME_PHASE = recoveryResult.report.phaseAfterRecovery;
  }
  if (resume && recoverySnapshotGate?.recommendedAction === "resume_withdraw") {
    childEnv.PR012B_RESUME_PHASE = "settlement_confirmed";
  }
  if (resume && recoverySnapshotGate?.recommendedAction === "resume_settlement") {
    childEnv.PR012B_RESUME_PHASE = "preflight_bound";
  }
  if (resume && recoverySnapshotGate?.recommendedAction === "settle_fifo_prefix") {
    childEnv.PR012B_RESUME_PHASE = "preflight_bound";
  }
  if (validation.report?.noteState.statePath) {
    childEnv.BASE_TO_SOLANA_BRIDGE_STATE_PATH = validation.report.noteState.statePath;
  }
  if (validation.report?.sourceBridgeOutHash) {
    childEnv.PR012B_SOURCE_MESSAGE_HASH = validation.report.sourceBridgeOutHash;
  }
  childEnv.PR012B_DESTINATION_MESSAGE_HASH = destinationHash;

  const executor = input.executor || defaultExecutor;
  const cwd = input.cwd || process.cwd();
  const executed = executor({ env: childEnv, cwd });
  if (executed.error || executed.status !== 0) {
    const failed: JobResult = {
      ...validation.gates,
      readiness: "failed_execute",
      jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
      jobIndexPath,
      status: "failed",
      resultPath: null,
      recoverySnapshotPath: recoverySnapshotGate?.path || null,
      recoverySnapshotSha256: recoverySnapshotGate?.sha256 || null,
      errors: [
        ...validation.gates.errors,
        executed.error?.message || `verify_script_exit_${executed.status}`,
      ],
      secretsPrinted: false,
    };
    const failedEntry = jobEntryFromReport({
      gates: failed,
      report: validation.report,
      status: "failed",
      recoverySnapshotGate,
      nowIso: new Date(Date.now()).toISOString(),
      existing: executingEntry || undefined,
    });
    if (failedEntry) upsertJobEntry(jobIndexPath, failedEntry);
    ensureNoSecretsRendered(failed);
    return failed;
  }

  const raw = fs.existsSync(rawResultPath) ? JSON.parse(fs.readFileSync(rawResultPath, "utf8")) : {};
  const verifyResult = sanitizeVerifyResult(raw);
  const finalReport: JobResult = {
    ...validation.gates,
    jobId: jobIdFor(validation.gates.destinationHash, validation.gates.preflightReportSha256),
    jobIndexPath,
    status: "executed",
    resultPath,
    recoverySnapshotPath: recoverySnapshotGate?.path || null,
    recoverySnapshotSha256: recoverySnapshotGate?.sha256 || null,
    recoveryReportPath: recoveryResult?.path || null,
    recovery: recoveryResult?.report,
    verifyResult,
    secretsPrinted: false,
  };
  ensureNoSecretsRendered(finalReport);
  fs.writeFileSync(resultPath, JSON.stringify(finalReport, null, 2), { mode: 0o600 });
  const succeededEntry = jobEntryFromReport({
    gates: validation.gates,
    report: validation.report,
    status: "succeeded",
    resultPath,
    verifyResult,
    recoverySnapshotGate,
    nowIso: new Date(Date.now()).toISOString(),
    existing: executingEntry || undefined,
  });
  if (succeededEntry) {
    succeededEntry.status = "succeeded";
    succeededEntry.recoveryReportPath = recoveryResult?.path || succeededEntry.recoveryReportPath;
    upsertJobEntry(jobIndexPath, succeededEntry);
  }
  return finalReport;
}

async function main(): Promise<void> {
  const result = await runSettleWithdrawJob({ cwd: process.cwd() });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.status === "blocked" || result.status === "failed" ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, status: "failed", error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
