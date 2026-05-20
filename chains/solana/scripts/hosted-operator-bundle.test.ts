import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { runOperatorBundle } from "./hosted-operator-bundle";

const DESTINATION_HASH = `0x${"22".repeat(32)}`;
const SOURCE_HASH = `0x${"11".repeat(32)}`;

type MockOptions = {
  recoveryStatus?: number;
  recoveryReadiness?: string;
  recoveryAction?: string;
  spentExists?: boolean;
  withdrawAlreadyConsumed?: boolean;
  jobStatus?: string;
  finalReadiness?: string;
  includeSecretFields?: boolean;
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr012v-bundle-test-"));
}

function baseEnv(dir: string): Record<string, string> {
  return {
    BRIDGE_DAEMON_MODE: "paper",
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "false",
    BRIDGE_SETTLE_WITHDRAW_EXECUTE: "false",
    BRIDGE_RESULTS_DIR: dir,
    BRIDGE_OPERATOR_JOB_INDEX_PATH: path.join(dir, "operator-job-index.json"),
    PR012B_DESTINATION_MESSAGE_HASH: DESTINATION_HASH,
    PR012B_SOURCE_MESSAGE_HASH: SOURCE_HASH,
  };
}

function makeExecutor(dir: string, order: string[], options: MockOptions = {}) {
  return (input: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }) => {
    const script = input.args[input.args.length - 1];
    order.push(script);
    const preflightPath = path.join(dir, `preflight-${DESTINATION_HASH.slice(2)}.json`);
    const recoveryPath = path.join(dir, `recovery-snapshot-${DESTINATION_HASH.slice(2)}.json`);

    if (script === "bridge:operator:status") {
      const secondStatus = order.filter((value) => value === "bridge:operator:status").length > 1;
      const finalReadiness = options.finalReadiness || (options.withdrawAlreadyConsumed === true ? "already_complete" : "ready_for_execute");
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          final: {
            readiness: secondStatus ? finalReadiness : "blocked_preflight_stale",
            recommendedAction: secondStatus ? "run_job_execute" : "run_preflight",
          },
          leafIndex: {
            present: true,
            path: path.join(dir, `leaf-index-${DESTINATION_HASH.slice(2)}.json`),
            sha256: "b".repeat(64),
            leafIndex: 9,
            evidenceSource: "manual_operator_review",
          },
          transactionsSubmitted: false,
          proofsGenerated: false,
          secretsPrinted: false,
        }),
        stderr: "",
      };
    }

    if (script === "bridge:preflight:settle-withdraw") {
      const report = {
        ok: true,
        readiness: "ready",
        reportPath: preflightPath,
        destinationBridgeMintHash: DESTINATION_HASH,
        sourceBridgeOutHash: SOURCE_HASH,
        wallet: {
          present: ["SOLANA_DEVNET_RPC_URL", "SOLANA_POOL_AUTHORITY_KEYPAIR"],
        },
        noteState: options.includeSecretFields ? { destSecret: "super-secret", destNullifier: "super-nullifier" } : undefined,
        transactionsSubmitted: false,
        proofsGenerated: false,
        secretsPrinted: false,
      };
      fs.writeFileSync(preflightPath, JSON.stringify(report, null, 2), { mode: 0o600 });
      return { status: 0, stdout: JSON.stringify(report), stderr: "" };
    }

    if (script === "bridge:recovery:snapshot") {
      const report = {
        ok: options.recoveryStatus === 1 ? false : true,
        readiness: options.recoveryReadiness || "ready_for_resume",
        recommendedAction: options.recoveryAction || "resume_withdraw",
        reportPath: recoveryPath,
        destinationMessageHash: DESTINATION_HASH,
        sourceMessageHash: SOURCE_HASH,
        leafIndexEvidence: {
          found: true,
          path: path.join(dir, `leaf-index-${DESTINATION_HASH.slice(2)}.json`),
          sha256: "b".repeat(64),
          source: "manual_operator_review",
          leafIndex: 9,
        },
        spentNullifier: {
          derived: true,
          status: "derived",
          spentNullifierPda: "spentPda",
          exists: options.spentExists ?? false,
          withdrawAlreadyConsumed: options.withdrawAlreadyConsumed ?? false,
        },
        transactionsSubmitted: false,
        proofsGenerated: false,
        secretsPrinted: false,
      };
      fs.writeFileSync(recoveryPath, JSON.stringify(report, null, 2), { mode: 0o600 });
      return { status: options.recoveryStatus ?? 0, stdout: JSON.stringify(report), stderr: "" };
    }

    if (script === "bridge:job:settle-withdraw") {
      assert.strictEqual(input.env.BRIDGE_SETTLE_WITHDRAW_EXECUTE, "false");
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          readiness: "ready",
          status: options.jobStatus || "dry_run_ready",
          execute: false,
          wouldExecute: false,
          jobId: "job",
          recoverySnapshotSha256: "c".repeat(64),
          transactionsSubmittedByWrapper: false,
          secretsPrinted: false,
        }),
        stderr: "",
      };
    }

    return { status: 1, stdout: "{}", stderr: "unexpected script" };
  };
}

function assertNoSecrets(value: unknown): void {
  const rendered = JSON.stringify(value);
  assert.ok(!rendered.includes("super-secret"));
  assert.ok(!rendered.includes("super-nullifier"));
  assert.ok(!rendered.includes("destSecret"));
  assert.ok(!rendered.includes("destNullifier"));
  assert.ok(!rendered.includes("privateKey"));
  assert.ok(!rendered.includes("witness"));
}

async function run(): Promise<void> {
  {
    const dir = tmpDir();
    const order: string[] = [];
    const bundle = await runOperatorBundle({ env: baseEnv(dir), cwd: dir, executor: makeExecutor(dir, order) });
    assert.deepStrictEqual(order, [
      "bridge:operator:status",
      "bridge:preflight:settle-withdraw",
      "bridge:recovery:snapshot",
      "bridge:operator:status",
      "bridge:job:settle-withdraw",
    ]);
    assert.strictEqual(bundle.final.readiness, "ready_for_execute");
    assert.strictEqual(bundle.dryRunJob.status, "dry_run_ready");
    assert.strictEqual(bundle.transactionsSubmitted, false);
    assert.ok(bundle.reportPath && fs.existsSync(bundle.reportPath));
  }

  {
    const dir = tmpDir();
    const order: string[] = [];
    const env = { ...baseEnv(dir), BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "true" };
    const bundle = await runOperatorBundle({ env, cwd: dir, executor: makeExecutor(dir, order) });
    assert.deepStrictEqual(order, []);
    assert.strictEqual(bundle.ok, false);
    assert.ok(bundle.errors.includes("live_submit_enabled"));
    assert.strictEqual(bundle.transactionsSubmitted, false);
  }

  {
    const dir = tmpDir();
    const order: string[] = [];
    const env = { ...baseEnv(dir), BRIDGE_SETTLE_WITHDRAW_EXECUTE: "true" };
    const bundle = await runOperatorBundle({ env, cwd: dir, executor: makeExecutor(dir, order) });
    assert.deepStrictEqual(order, []);
    assert.strictEqual(bundle.ok, false);
    assert.ok(bundle.errors.includes("execute_flag_enabled"));
  }

  {
    const dir = tmpDir();
    const order: string[] = [];
    const bundle = await runOperatorBundle({
      env: baseEnv(dir),
      cwd: dir,
      executor: makeExecutor(dir, order, {
        recoveryReadiness: "already_withdrawn_spent_nullifier",
        recoveryAction: "no_action_already_complete",
        spentExists: true,
        withdrawAlreadyConsumed: true,
        finalReadiness: "already_complete",
      }),
    });
    assert.strictEqual(bundle.final.readiness, "no_action_already_complete");
    assert.strictEqual(bundle.final.recommendedAction, "no_action_already_complete");
    assert.strictEqual(bundle.final.alreadyComplete, true);
    assert.strictEqual(bundle.final.executionAllowed, false);
  }

  {
    const dir = tmpDir();
    const order: string[] = [];
    const bundle = await runOperatorBundle({
      env: baseEnv(dir),
      cwd: dir,
      executor: makeExecutor(dir, order, { recoveryStatus: 1, recoveryReadiness: "blocked_spent_nullifier_unknown" }),
    });
    assert.strictEqual(bundle.final.readiness, "blocked_recovery_snapshot");
    assert.strictEqual(bundle.dryRunJob.status, "dry_run_ready");
  }

  {
    const dir = tmpDir();
    const order: string[] = [];
    const bundle = await runOperatorBundle({
      env: baseEnv(dir),
      cwd: dir,
      executor: makeExecutor(dir, order, { includeSecretFields: true }),
    });
    assertNoSecrets(bundle);
  }

  console.log(JSON.stringify({ ok: true, status: "hosted_operator_bundle_tests_passed" }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
