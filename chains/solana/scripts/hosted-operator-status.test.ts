import * as assert from "assert";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { buildOperatorStatus } from "./hosted-operator-status";

const DESTINATION_HASH = `0x${"22".repeat(32)}`;
const SOURCE_HASH = `0x${"11".repeat(32)}`;
const COMMITMENT_HEX = `0x${"33".repeat(32)}`;
const tempRoots: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".pr012q-test-"));
  tempRoots.push(dir);
  return dir;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function baseEnv(root: string): Record<string, string> {
  const artifactDir = path.join(root, "data/circuit-artifacts");
  const circuitBase = path.join(root, "repo/circuits");
  const merklePath = path.join(artifactDir, "merkle_batch_update/merkle_batch_update.zkey");
  const withdrawPath = path.join(artifactDir, "withdraw/withdraw.zkey");
  writeFile(merklePath, "merkle fixture");
  writeFile(withdrawPath, "withdraw fixture");
  fs.mkdirSync(path.join(circuitBase, "merkle_batch_update/build"), { recursive: true });
  fs.mkdirSync(path.join(circuitBase, "withdraw/build"), { recursive: true });
  fs.symlinkSync(merklePath, path.join(circuitBase, "merkle_batch_update/build/merkle_batch_update.zkey"));
  fs.symlinkSync(withdrawPath, path.join(circuitBase, "withdraw/build/withdraw.zkey"));
  return {
    BRIDGE_DAEMON_MODE: "paper",
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "false",
    BRIDGE_CIRCUIT_ARTIFACT_DIR: artifactDir,
    PR012P_CIRCUIT_BASE: circuitBase,
    PR012P_EXPECTED_MERKLE_ZKEY_SHA256: sha256(merklePath),
    PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256: sha256(withdrawPath),
    BRIDGE_NOTE_STATE_BACKUP_DIR: path.join(root, "data/white-bridge-note-state"),
    BRIDGE_RESULTS_DIR: path.join(root, "data/bridge-results"),
    BRIDGE_OPERATOR_JOB_INDEX_PATH: path.join(root, "data/bridge-results/operator-job-index.json"),
    PR012B_DESTINATION_MESSAGE_HASH: DESTINATION_HASH,
    PR012B_SOURCE_MESSAGE_HASH: SOURCE_HASH,
  };
}

function writeReports(env: Record<string, string>, nowMs: number, overrides: {
  preflightGeneratedAt?: string;
  recoveryGeneratedAt?: string;
  recoveryReadiness?: string;
  recoveryAction?: string;
  jobStatus?: string;
  omitLeaf?: boolean;
  omitNote?: boolean;
} = {}): void {
  if (!overrides.omitNote) {
    writeFile(
      path.join(env.BRIDGE_NOTE_STATE_BACKUP_DIR, `${DESTINATION_HASH.slice(2)}.bridge-note-state.json`),
      JSON.stringify({ destSecret: "redacted-by-status", destNullifier: "also-redacted" })
    );
  }
  if (!overrides.omitLeaf) {
    writeFile(
      path.join(env.BRIDGE_RESULTS_DIR, `leaf-index-${DESTINATION_HASH.slice(2)}.json`),
      JSON.stringify({
        destinationMessageHash: DESTINATION_HASH,
        sourceMessageHash: SOURCE_HASH,
        destinationCommitment: COMMITMENT_HEX,
        settlementTx: "settleTx",
        leafIndex: 9,
        pendingIndexBeforeSettlement: 0,
        merkleNextLeafIndexBefore: 9,
        merkleNextLeafIndexAfter: 10,
        rootBefore: null,
        rootAfter: null,
        evidenceSource: "manual_operator_review",
        createdAt: new Date(nowMs).toISOString(),
      }, null, 2)
    );
  }
  writeFile(
    path.join(env.BRIDGE_RESULTS_DIR, `preflight-${DESTINATION_HASH.slice(2)}.json`),
    JSON.stringify({
      ok: true,
      readiness: "ready",
      generatedAt: overrides.preflightGeneratedAt || new Date(nowMs).toISOString(),
      route: "base-sepolia->solana-devnet",
      sourceBridgeOutHash: SOURCE_HASH,
      destinationBridgeMintHash: DESTINATION_HASH,
      destinationCommitment: COMMITMENT_HEX,
      transactionsSubmitted: false,
      secretsPrinted: false,
    }, null, 2)
  );
  writeFile(
    path.join(env.BRIDGE_RESULTS_DIR, `recovery-snapshot-${DESTINATION_HASH.slice(2)}.json`),
    JSON.stringify({
      ok: true,
      generatedAt: overrides.recoveryGeneratedAt || new Date(nowMs).toISOString(),
      destinationMessageHash: DESTINATION_HASH,
      sourceMessageHash: SOURCE_HASH,
      readiness: overrides.recoveryReadiness || "ready_for_resume",
      recommendedAction: overrides.recoveryAction || "resume_withdraw",
      spentNullifier: {
        spentNullifierPda: "spentPda",
        exists: false,
        withdrawAlreadyConsumed: false,
      },
      transactionsSubmitted: false,
      proofsGenerated: false,
      secretsPrinted: false,
    }, null, 2)
  );
  if (overrides.jobStatus) {
    writeFile(
      env.BRIDGE_OPERATOR_JOB_INDEX_PATH,
      JSON.stringify({
        version: 1,
        jobs: [{
          jobId: "job",
          jobType: "settle_withdraw",
          destinationMessageHash: DESTINATION_HASH,
          sourceMessageHash: SOURCE_HASH,
          status: overrides.jobStatus,
          preflightReportSha256: "preflightHash",
          recoverySnapshotSha256: "recoveryHash",
          settlementTx: null,
          withdrawTx: null,
          resultReportPath: null,
        }],
      }, null, 2)
    );
  }
}

function assertNoSecrets(value: unknown): void {
  const rendered = JSON.stringify(value);
  assert.ok(!rendered.includes("redacted-by-status"));
  assert.ok(!rendered.includes("also-redacted"));
  assert.ok(!rendered.includes("destSecret"));
  assert.ok(!rendered.includes("destNullifier"));
  assert.ok(!rendered.includes("privateKey"));
  assert.ok(!rendered.includes("witness"));
}

function run(): void {
  const nowMs = Date.parse("2026-05-20T12:00:00.000Z");

  {
    const root = tmpDir();
    const env = baseEnv(root);
    writeReports(env, nowMs, { jobStatus: "dry_run_ready" });
    const status = buildOperatorStatus({ env, nowMs });
    assert.strictEqual(status.final.readiness, "ready_for_execute");
    assert.strictEqual(status.final.recommendedAction, "run_job_execute");
    assert.ok(status.reportPath && fs.existsSync(status.reportPath));
    assertNoSecrets(status);
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    fs.rmSync(path.join(env.BRIDGE_CIRCUIT_ARTIFACT_DIR, "withdraw/withdraw.zkey"));
    writeReports(env, nowMs);
    assert.strictEqual(buildOperatorStatus({ env, nowMs }).final.readiness, "blocked_zkeys");
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    writeReports(env, nowMs, { omitNote: true });
    assert.strictEqual(buildOperatorStatus({ env, nowMs }).final.readiness, "blocked_note_state");
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    writeReports(env, nowMs, { preflightGeneratedAt: new Date(nowMs - 901_000).toISOString() });
    assert.strictEqual(buildOperatorStatus({ env, nowMs }).final.readiness, "blocked_preflight_stale");
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    writeReports(env, nowMs, { recoveryGeneratedAt: new Date(nowMs - 901_000).toISOString() });
    assert.strictEqual(buildOperatorStatus({ env, nowMs }).final.readiness, "blocked_recovery_stale");
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    writeReports(env, nowMs, { omitLeaf: true });
    assert.strictEqual(buildOperatorStatus({ env, nowMs }).final.readiness, "blocked_leaf_index_missing");
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    writeReports(env, nowMs, {
      jobStatus: "succeeded",
      recoveryReadiness: "ready_for_resume",
      recoveryAction: "resume_withdraw",
    });
    assert.strictEqual(buildOperatorStatus({ env, nowMs }).final.readiness, "already_complete");
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    writeReports(env, nowMs, { recoveryReadiness: "blocked_ambiguous_state", recoveryAction: "operator_review_required" });
    assert.strictEqual(buildOperatorStatus({ env, nowMs }).final.readiness, "operator_review_required");
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    const status = buildOperatorStatus({ env, nowMs, writeReport: false });
    assert.strictEqual(status.preflight.path, path.join(env.BRIDGE_RESULTS_DIR, `preflight-${DESTINATION_HASH.slice(2)}.json`));
    assert.strictEqual(status.recovery.path, path.join(env.BRIDGE_RESULTS_DIR, `recovery-snapshot-${DESTINATION_HASH.slice(2)}.json`));
  }

  console.log(JSON.stringify({ ok: true, status: "hosted_operator_status_tests_passed" }, null, 2));
}

try {
  run();
} finally {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
