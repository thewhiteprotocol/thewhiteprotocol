import * as assert from "assert";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  runSettleWithdrawJob,
  validatePreflightForJob,
  type JobResult,
} from "./hosted-settle-withdraw-job";
import { summarizeJobIndex } from "./hosted-settle-withdraw-job-index";
import type { HostedSettleWithdrawPreflight } from "./hosted-settle-withdraw-preflight";

const DESTINATION_HASH = `0x${"22".repeat(32)}`;
const SOURCE_HASH = `0x${"11".repeat(32)}`;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr012h-job-test-"));
}

function baseEnv(dir: string): Record<string, string> {
  return {
    BRIDGE_DAEMON_MODE: "paper",
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "false",
    PR012B_DESTINATION_MESSAGE_HASH: DESTINATION_HASH,
    BRIDGE_PREFLIGHT_REPORT_PATH: path.join(dir, "preflight.json"),
    BRIDGE_RESULTS_DIR: dir,
    BRIDGE_OPERATOR_JOB_INDEX_PATH: path.join(dir, "operator-job-index.json"),
  };
}

function report(overrides: Partial<HostedSettleWithdrawPreflight> = {}): HostedSettleWithdrawPreflight {
  const base: HostedSettleWithdrawPreflight = {
    ok: true,
    readiness: "ready",
    generatedAt: new Date().toISOString(),
    route: "base-sepolia->solana-devnet",
    sourceBridgeOutHash: SOURCE_HASH,
    destinationBridgeMintHash: DESTINATION_HASH,
    destinationCommitment: `0x${"33".repeat(32)}`,
    artifacts: {
      ok: true,
      artifactDir: "/data/circuit-artifacts",
      merkleZkey: {
        path: "circuits/merkle_batch_update/build/merkle_batch_update.zkey",
        exists: true,
        isSymlink: true,
        realPath: "/data/circuit-artifacts/merkle_batch_update/merkle_batch_update.zkey",
        persistentCopyExists: true,
        underPersistentDir: true,
        sha256: "107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9",
        expectedSha256: "107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9",
        hashMatches: true,
      },
      withdrawZkey: {
        path: "circuits/withdraw/build/withdraw.zkey",
        exists: true,
        isSymlink: true,
        realPath: "/data/circuit-artifacts/withdraw/withdraw.zkey",
        persistentCopyExists: true,
        underPersistentDir: true,
        sha256: "cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0",
        expectedSha256: "cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0",
        hashMatches: true,
      },
      merkleWasm: { path: "merkle.wasm", exists: true },
      withdrawWasm: { path: "withdraw.wasm", exists: true },
      errors: [],
    },
    noteState: {
      ok: true,
      backupDir: "/data/white-bridge-note-state",
      statePath: "/data/white-bridge-note-state/22.bridge-note-state.json",
      checks: {
        backupDirSet: true,
        backupDirExists: true,
        backupDirNotTmp: true,
        backupDirOutsideRepo: true,
        stateFileExists: true,
        sourceHash: true,
        destinationHash: true,
        destinationCommitment: true,
        amount: true,
        asset: true,
      },
      summary: {
        sourceBridgeOutHash: SOURCE_HASH,
        destinationBridgeMintHash: DESTINATION_HASH,
        destinationCommitment: "123",
        destinationAmount: "1000000",
        assetId: "456",
        hasDestSecret: true,
        hasDestNullifier: true,
      },
      errors: [],
    },
    pending: {
      ok: true,
      checked: true,
      status: "ready",
      poolConfig: "pool",
      merkleTree: "tree",
      pendingBuffer: "pending",
      assetVault: "vault",
      commitmentIndex: "commitment",
      consumedMessage: "consumed",
      consumedPdaExists: true,
      targetPending: true,
      targetAlreadySettled: false,
      targetPendingIndex: 0,
      pendingCount: 1,
      fifoPrefixRequired: false,
      fifoPrefixCount: 0,
      nextLeafIndex: 9,
      currentMerkleRoot: `0x${"44".repeat(32)}`,
      errors: [],
    },
    wallet: {
      ok: true,
      checked: true,
      present: ["ANCHOR_WALLET", "SOLANA_POOL_AUTHORITY_KEYPAIR"],
      missing: [],
      walletPublicKey: "wallet",
      walletBalanceSol: 1,
      expectedPoolAuthority: "wallet",
      poolAuthorityMatches: true,
      errors: [],
    },
    reportPath: "/data/bridge-results/preflight.json",
    transactionsSubmitted: false,
    secretsPrinted: false,
  };
  return { ...base, ...overrides } as HostedSettleWithdrawPreflight;
}

function writeReport(dir: string, value: HostedSettleWithdrawPreflight): void {
  fs.writeFileSync(path.join(dir, "preflight.json"), JSON.stringify(value, null, 2));
}

function recoverySnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    route: "base-sepolia->solana-devnet",
    destinationMessageHash: DESTINATION_HASH,
    sourceMessageHash: SOURCE_HASH,
    readiness: "ready_for_resume",
    recommendedAction: "resume_settlement",
    spentNullifier: {
      derived: true,
      status: "derived",
      spentNullifierPda: "11111111111111111111111111111111",
      leafIndex: 9,
      error: null,
      exists: false,
      checkedAt: new Date().toISOString(),
      withdrawAlreadyConsumed: false,
    },
    reportPath: null,
    transactionsSubmitted: false,
    proofsGenerated: false,
    secretsPrinted: false,
    ...overrides,
  };
}

function writeRecoverySnapshot(dir: string, value: Record<string, unknown> = recoverySnapshot()): string {
  const filePath = path.join(dir, `recovery-snapshot-${DESTINATION_HASH.slice(2)}.json`);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), { mode: 0o600 });
  return filePath;
}

function sha256(filePath: string): string {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readIndex(dir: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, "operator-job-index.json"), "utf8"));
}

function writeIndex(dir: string, index: any): void {
  fs.writeFileSync(path.join(dir, "operator-job-index.json"), JSON.stringify(index, null, 2), { mode: 0o600 });
}

function assertBlocked(result: JobResult, readiness: string): void {
  assert.strictEqual(result.status, "blocked");
  assert.strictEqual(result.readiness, readiness);
}

async function run(): Promise<void> {
  {
    const dir = tmpDir();
    const result = validatePreflightForJob({ env: baseEnv(dir) }).gates;
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.readiness, "blocked_missing_report");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report({ generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
    const result = validatePreflightForJob({ env: baseEnv(dir) }).gates;
    assert.strictEqual(result.readiness, "blocked_stale_report");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report({ destinationBridgeMintHash: `0x${"55".repeat(32)}` }));
    const result = validatePreflightForJob({ env: baseEnv(dir) }).gates;
    assert.strictEqual(result.readiness, "blocked_destination_mismatch");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report({ readiness: "blocked_artifacts" }));
    const result = validatePreflightForJob({ env: baseEnv(dir) }).gates;
    assert.strictEqual(result.readiness, "blocked_readiness");
  }

  {
    const dir = tmpDir();
    const r = report();
    r.artifacts.merkleZkey.hashMatches = false;
    writeReport(dir, r);
    const result = validatePreflightForJob({ env: baseEnv(dir) }).gates;
    assert.strictEqual(result.readiness, "blocked_artifacts");
  }

  {
    const dir = tmpDir();
    const r = report();
    r.noteState.summary.hasDestSecret = false;
    writeReport(dir, r);
    const result = validatePreflightForJob({ env: baseEnv(dir) }).gates;
    assert.strictEqual(result.readiness, "blocked_note_state");
  }

  {
    const dir = tmpDir();
    const r = report();
    r.wallet.poolAuthorityMatches = false;
    writeReport(dir, r);
    const result = validatePreflightForJob({ env: baseEnv(dir) }).gates;
    assert.strictEqual(result.readiness, "blocked_wallet");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    const env = { ...baseEnv(dir), BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "true" };
    const result = validatePreflightForJob({ env }).gates;
    assert.strictEqual(result.readiness, "blocked_safe_mode");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    let called = false;
    const result = await runSettleWithdrawJob({
      env: baseEnv(dir),
      executor: () => {
        called = true;
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(result.status, "dry_run_ready");
    assert.strictEqual(called, false);
    assert.strictEqual(result.preflightReportSha256, sha256(path.join(dir, "preflight.json")));
    assert.ok(result.jobId);
    const index = readIndex(dir);
    assert.strictEqual(index.jobs.length, 1);
    assert.strictEqual(index.jobs[0].status, "dry_run_ready");
    assert.strictEqual(index.jobs[0].preflightReportSha256, result.preflightReportSha256);
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    const snapshotPath = writeRecoverySnapshot(dir);
    const result = await runSettleWithdrawJob({ env: baseEnv(dir) });
    assert.strictEqual(result.status, "dry_run_ready");
    assert.strictEqual(result.recoverySnapshotPath, snapshotPath);
    assert.strictEqual(result.recoverySnapshotSha256, sha256(snapshotPath));
    const index = readIndex(dir);
    assert.strictEqual(index.jobs[0].recoverySnapshotPath, snapshotPath);
    assert.strictEqual(index.jobs[0].recoverySnapshotSha256, sha256(snapshotPath));
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir, recoverySnapshot({
      readiness: "blocked_spent_nullifier_unknown",
      recommendedAction: "operator_review_required",
      spentNullifier: {
        derived: false,
        status: "missing_field",
        spentNullifierPda: null,
        leafIndex: null,
        error: "leaf_index_missing",
        exists: null,
        checkedAt: null,
        withdrawAlreadyConsumed: false,
      },
    }));
    const result = await runSettleWithdrawJob({ env: baseEnv(dir) });
    assertBlocked(result, "blocked_recovery_snapshot_readiness");
    assert.ok(result.errors.some((error) => error.includes("blocked_spent_nullifier_unknown")));
    assert.strictEqual(result.wouldExecute, false);
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_REQUIRE_RECOVERY_SNAPSHOT_DRY_RUN: "true" },
    });
    assertBlocked(result, "blocked_recovery_snapshot_missing");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    const env = {
      ...baseEnv(dir),
      BRIDGE_EXPECTED_PREFLIGHT_SHA256: "0".repeat(64),
    };
    const result = validatePreflightForJob({ env }).gates;
    assert.strictEqual(result.readiness, "blocked_preflight_hash");
    assert.ok(result.errors.includes("preflight_sha256_mismatch"));
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      executor: () => {
        throw new Error("executor should not run without recovery snapshot");
      },
    });
    assertBlocked(result, "blocked_recovery_snapshot_missing");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir, recoverySnapshot({ generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      executor: () => {
        throw new Error("executor should not run with stale recovery snapshot");
      },
    });
    assertBlocked(result, "blocked_recovery_snapshot_stale");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir, recoverySnapshot({ destinationMessageHash: `0x${"66".repeat(32)}` }));
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      executor: () => {
        throw new Error("executor should not run with mismatched recovery snapshot");
      },
    });
    assertBlocked(result, "blocked_recovery_snapshot_mismatch");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir);
    const result = await runSettleWithdrawJob({
      env: {
        ...baseEnv(dir),
        BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true",
        BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256: "0".repeat(64),
      },
      executor: () => {
        throw new Error("executor should not run with recovery snapshot hash mismatch");
      },
    });
    assertBlocked(result, "blocked_recovery_snapshot_hash");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir, recoverySnapshot({
      readiness: "blocked_ambiguous_state",
      recommendedAction: "operator_review_required",
    }));
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      executor: () => {
        throw new Error("executor should not run with ambiguous recovery snapshot");
      },
    });
    assertBlocked(result, "blocked_recovery_snapshot_readiness");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir, recoverySnapshot({ recommendedAction: "resume_withdraw" }));
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      executor: () => {
        throw new Error("executor should not run when recovery action does not match non-resume execute");
      },
    });
    assertBlocked(result, "blocked_recovery_snapshot_action");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir);
    let called = false;
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      cwd: "/tmp",
      beforeExecute: () => {
        const changed = report();
        changed.pending.pendingCount = 2;
        writeReport(dir, changed);
      },
      executor: () => {
        called = true;
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(called, false);
    assertBlocked(result, "blocked_preflight_hash");
    assert.ok(result.errors.includes("preflight_report_changed_after_binding"));
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir);
    let called = false;
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      cwd: "/tmp",
      beforeExecute: () => {
        writeRecoverySnapshot(dir, recoverySnapshot({ recommendedAction: "settle_fifo_prefix" }));
      },
      executor: () => {
        called = true;
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(called, false);
    assertBlocked(result, "blocked_recovery_snapshot_hash");
    assert.ok(result.errors.includes("recovery_snapshot_changed_after_binding"));
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    const snapshotPath = writeRecoverySnapshot(dir);
    let called = false;
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      cwd: "/tmp",
      executor: ({ env }) => {
        called = true;
        fs.writeFileSync(
          env.PR012B_RESULT_PATH!,
          JSON.stringify({
            ok: true,
            status: "success",
            evidence: {
              sourceBridgeOutHash: SOURCE_HASH,
              destinationBridgeMintHash: DESTINATION_HASH,
              settleTx: "settleTx",
              withdrawTx: "withdrawTx",
              duplicateWithdrawRejected: true,
              destSecret: "super-secret-sentinel",
              destNullifier: "super-nullifier-sentinel",
            },
          })
        );
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(called, true);
    assert.strictEqual(result.status, "executed");
    assert.ok(result.resultPath);
    assert.ok(result.jobId);
    const rendered = JSON.stringify(result);
    assert.ok(!rendered.includes("super-secret-sentinel"));
    assert.ok(!rendered.includes("super-nullifier-sentinel"));
    assert.ok(fs.existsSync(result.resultPath!));
    const index = readIndex(dir);
    assert.strictEqual(index.jobs.length, 1);
    assert.strictEqual(index.jobs[0].status, "succeeded");
    assert.strictEqual(index.jobs[0].settlementTx, "settleTx");
    assert.strictEqual(index.jobs[0].withdrawTx, "withdrawTx");
    assert.strictEqual(index.jobs[0].resultReportPath, result.resultPath);
    assert.strictEqual(index.jobs[0].recoverySnapshotPath, snapshotPath);
    assert.strictEqual(index.jobs[0].recoverySnapshotSha256, sha256(snapshotPath));
    assert.strictEqual(result.recoverySnapshotSha256, sha256(snapshotPath));
    const summary = summarizeJobIndex({ env: baseEnv(dir) });
    assert.strictEqual((summary.jobs as any[]).length, 1);
    assert.ok(!JSON.stringify(summary).includes("super-secret-sentinel"));
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir);
    const env = { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" };
    const executor = ({ env: childEnv }: { env: NodeJS.ProcessEnv }) => {
      fs.writeFileSync(
        childEnv.PR012B_RESULT_PATH!,
        JSON.stringify({
          ok: true,
          status: "success",
          evidence: {
            sourceBridgeOutHash: SOURCE_HASH,
            destinationBridgeMintHash: DESTINATION_HASH,
            settleTx: "settleTx",
            withdrawTx: "withdrawTx",
            duplicateWithdrawRejected: true,
          },
        })
      );
      return { status: 0, stdout: "", stderr: "" };
    };
    const first = await runSettleWithdrawJob({ env, cwd: "/tmp", executor });
    assert.strictEqual(first.status, "executed");
    const second = await runSettleWithdrawJob({
      env,
      cwd: "/tmp",
      executor: () => {
        throw new Error("duplicate executor should not run");
      },
    });
    assertBlocked(second, "blocked_duplicate_execution");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    writeRecoverySnapshot(dir);
    const result = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      cwd: "/tmp",
      executor: () => ({ status: 1, stdout: "", stderr: "privateKey=redacted" }),
    });
    assert.strictEqual(result.status, "failed");
    const index = readIndex(dir);
    assert.strictEqual(index.jobs[0].status, "failed");
    assert.strictEqual(index.jobs[0].errorCode, "verify_script_exit_1");
    assert.ok(!JSON.stringify(index).includes("privateKey=redacted"));
  }

  {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "operator-job-index.json"), "{not-json", { mode: 0o600 });
    writeReport(dir, report());
    const result = await runSettleWithdrawJob({ env: baseEnv(dir) });
    assert.strictEqual(result.status, "dry_run_ready");
    const index = readIndex(dir);
    assert.strictEqual(index.version, 1);
    assert.strictEqual(index.jobs.length, 1);
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    const dry = await runSettleWithdrawJob({ env: baseEnv(dir) });
    const index = readIndex(dir);
    index.jobs[0].status = "settlement_confirmed";
    index.jobs[0].settlementTx = "settleTx";
    writeIndex(dir, index);
    writeRecoverySnapshot(dir);
    const blocked = await runSettleWithdrawJob({
      env: { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" },
      executor: () => {
        throw new Error("partial job executor should not run without resume");
      },
    });
    assertBlocked(blocked, "blocked_duplicate_execution");
    assert.ok(dry.jobId);
  }

  {
    const dir = tmpDir();
    const r = report();
    r.pending.targetPending = false;
    r.pending.targetAlreadySettled = true;
    r.pending.status = "already_settled";
    writeReport(dir, r);
    await runSettleWithdrawJob({ env: baseEnv(dir) });
    const index = readIndex(dir);
    index.jobs[0].status = "settlement_confirmed";
    index.jobs[0].settlementTx = "settleTx";
    writeIndex(dir, index);
    writeRecoverySnapshot(dir, recoverySnapshot({
      readiness: "already_settled_pending_missing",
      recommendedAction: "resume_withdraw",
    }));
    let resumePhase = "";
    const result = await runSettleWithdrawJob({
      env: {
        ...baseEnv(dir),
        BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true",
        BRIDGE_SETTLE_WITHDRAW_RESUME: "true",
      },
      cwd: "/tmp",
      recoveryChecker: ({ report }) => ({
        checked: true,
        consumedPdaExists: true,
        commitmentIndexExists: true,
        targetPending: false,
        targetAlreadySettled: true,
        targetPendingIndex: null,
        pendingCount: report.pending.pendingCount,
        fifoPrefixRequired: false,
        spentNullifierExists: false,
        settlementTxStatus: "confirmed",
        withdrawTxStatus: null,
        inferredPhase: "settlement_confirmed",
        ambiguous: false,
        errors: [],
      }),
      executor: ({ env }) => {
        resumePhase = env.PR012B_RESUME_PHASE || "";
        fs.writeFileSync(
          env.PR012B_RESULT_PATH!,
          JSON.stringify({
            ok: true,
            status: "success",
            evidence: {
              sourceBridgeOutHash: SOURCE_HASH,
              destinationBridgeMintHash: DESTINATION_HASH,
              settleTx: "settleTx",
              withdrawTx: "withdrawTx",
              duplicateWithdrawRejected: true,
            },
          })
        );
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(result.status, "executed");
    assert.strictEqual(resumePhase, "settlement_confirmed");
    assert.ok(result.recoveryReportPath);
    assert.ok(fs.existsSync(result.recoveryReportPath!));
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    await runSettleWithdrawJob({ env: baseEnv(dir) });
    writeRecoverySnapshot(dir, recoverySnapshot({
      readiness: "ready_for_resume",
      recommendedAction: "resume_settlement",
    }));
    let resumePhase = "";
    const result = await runSettleWithdrawJob({
      env: {
        ...baseEnv(dir),
        BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true",
        BRIDGE_SETTLE_WITHDRAW_RESUME: "true",
      },
      cwd: "/tmp",
      executor: ({ env }) => {
        resumePhase = env.PR012B_RESUME_PHASE || "";
        fs.writeFileSync(
          env.PR012B_RESULT_PATH!,
          JSON.stringify({
            ok: true,
            status: "success",
            evidence: {
              sourceBridgeOutHash: SOURCE_HASH,
              destinationBridgeMintHash: DESTINATION_HASH,
              settleTx: "settleTx",
              withdrawTx: "withdrawTx",
              duplicateWithdrawRejected: true,
            },
          })
        );
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(result.status, "executed");
    assert.strictEqual(resumePhase, "preflight_bound");
  }

  {
    const dir = tmpDir();
    writeReport(dir, report());
    await runSettleWithdrawJob({ env: baseEnv(dir) });
    const index = readIndex(dir);
    index.jobs[0].status = "settlement_submitted";
    index.jobs[0].settlementTx = "settleTx";
    writeIndex(dir, index);
    writeRecoverySnapshot(dir);
    const result = await runSettleWithdrawJob({
      env: {
        ...baseEnv(dir),
        BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true",
        BRIDGE_SETTLE_WITHDRAW_RESUME: "true",
      },
      recoveryChecker: () => ({
        checked: true,
        consumedPdaExists: true,
        commitmentIndexExists: false,
        targetPending: true,
        targetAlreadySettled: false,
        targetPendingIndex: 0,
        pendingCount: 1,
        fifoPrefixRequired: false,
        spentNullifierExists: false,
        settlementTxStatus: "unknown",
        withdrawTxStatus: null,
        inferredPhase: "recovery_required",
        ambiguous: true,
        errors: ["settlement_tx_status_unknown"],
      }),
      executor: () => {
        throw new Error("ambiguous resume executor should not run");
      },
    });
    assertBlocked(result, "blocked_duplicate_execution");
    assert.ok(result.recoveryReportPath);
    assert.ok(!JSON.stringify(result).includes("destSecret"));
  }

  {
    const dir = tmpDir();
    const r = report();
    r.pending.targetPending = false;
    r.pending.targetAlreadySettled = true;
    r.pending.status = "already_settled";
    writeReport(dir, r);
    await runSettleWithdrawJob({ env: baseEnv(dir) });
    const index = readIndex(dir);
    index.jobs[0].status = "withdraw_confirmed";
    index.jobs[0].settlementTx = "settleTx";
    index.jobs[0].withdrawTx = "withdrawTx";
    writeIndex(dir, index);
    writeRecoverySnapshot(dir, recoverySnapshot({
      readiness: "already_withdrawn_spent_nullifier",
      recommendedAction: "no_action_already_complete",
      spentNullifier: {
        derived: true,
        status: "derived",
        spentNullifierPda: "11111111111111111111111111111111",
        leafIndex: 9,
        error: null,
        exists: true,
        checkedAt: new Date().toISOString(),
        withdrawAlreadyConsumed: true,
      },
    }));
    let called = false;
    const result = await runSettleWithdrawJob({
      env: {
        ...baseEnv(dir),
        BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true",
        BRIDGE_SETTLE_WITHDRAW_RESUME: "true",
      },
      recoveryChecker: () => ({
        checked: true,
        consumedPdaExists: true,
        commitmentIndexExists: true,
        targetPending: false,
        targetAlreadySettled: true,
        targetPendingIndex: null,
        pendingCount: 0,
        fifoPrefixRequired: false,
        spentNullifierExists: true,
        settlementTxStatus: "confirmed",
        withdrawTxStatus: "confirmed",
        inferredPhase: "duplicate_withdraw_checked",
        ambiguous: false,
        errors: [],
      }),
      executor: () => {
        called = true;
        return { status: 0, stdout: "", stderr: "" };
      },
    });
    assert.strictEqual(called, false);
    assert.strictEqual(result.status, "executed");
    const updated = readIndex(dir);
    assert.strictEqual(updated.jobs[0].status, "succeeded");
  }

  console.log(JSON.stringify({ ok: true, status: "hosted_settle_withdraw_job_tests_passed" }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
