/**
 * Non-secret hosted settlement/withdraw operator job index reader.
 */

import * as fs from "fs";

import { jobIndexPathFor, type OperatorJobEntry, type OperatorJobIndex } from "./hosted-settle-withdraw-job";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

function normalizeHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^0x[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function readIndex(indexPath: string): OperatorJobIndex {
  if (!fs.existsSync(indexPath)) return { version: 1, jobs: [] };
  const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8")) as Partial<OperatorJobIndex>;
  return { version: 1, jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [] };
}

function publicJobSummary(job: OperatorJobEntry): Record<string, unknown> {
  return {
    jobId: job.jobId,
    jobType: job.jobType,
    route: job.route,
    destinationMessageHash: job.destinationMessageHash,
    sourceMessageHash: job.sourceMessageHash,
    destinationCommitment: job.destinationCommitment,
    preflightReportPath: job.preflightReportPath,
    preflightReportSha256: job.preflightReportSha256,
    preflightCreatedAt: job.preflightCreatedAt,
    preflightMaxAgeSeconds: job.preflightMaxAgeSeconds,
    recoverySnapshotPath: job.recoverySnapshotPath || null,
    recoverySnapshotSha256: job.recoverySnapshotSha256 || null,
    recoverySnapshotCreatedAt: job.recoverySnapshotCreatedAt || null,
    recoverySnapshotReadiness: job.recoverySnapshotReadiness || null,
    recoverySnapshotRecommendedAction: job.recoverySnapshotRecommendedAction || null,
    noteStatePath: job.noteStatePath,
    zkeyHashes: job.zkeyHashes,
    fifoPlan: job.fifoPlan,
    walletPublicKey: job.walletPublicKey,
    poolAuthorityExpected: job.poolAuthorityExpected,
    poolAuthorityMatched: job.poolAuthorityMatched,
    mode: job.mode,
    executeRequested: job.executeRequested,
    status: job.status,
    settlementTx: job.settlementTx,
    withdrawTx: job.withdrawTx,
    duplicateWithdrawResult: job.duplicateWithdrawResult,
    resultReportPath: job.resultReportPath,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    errorCode: job.errorCode,
    errorSummary: job.errorSummary,
  };
}

export function summarizeJobIndex(input: {
  env?: Env;
  destinationHash?: string | null;
} = {}): Record<string, unknown> {
  const env = input.env || process.env;
  const indexPath = jobIndexPathFor(env);
  const destinationHash =
    normalizeHash(input.destinationHash) ||
    normalizeHash(env.BRIDGE_DESTINATION_MESSAGE_HASH || env.PR012B_DESTINATION_MESSAGE_HASH);
  const index = readIndex(indexPath);
  const jobs = destinationHash
    ? index.jobs.filter((job) => job.destinationMessageHash?.toLowerCase() === destinationHash)
    : index.jobs;
  return {
    ok: true,
    indexPath,
    destinationHash,
    count: jobs.length,
    jobs: jobs.map(publicJobSummary),
  };
}

async function main(): Promise<void> {
  const destinationHash = process.argv.find((arg) => arg.startsWith("0x")) || null;
  console.log(JSON.stringify(summarizeJobIndex({ destinationHash }), null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
    process.exit(1);
  });
}
