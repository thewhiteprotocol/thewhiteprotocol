import * as assert from "assert";
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { bootstrapZkeys } from "./hosted-zkey-bootstrap";
import { runOperatorPrereq } from "./hosted-operator-prereq";

const DESTINATION_HASH = `0x${"22".repeat(32)}`;
const SOURCE_HASH = `0x${"11".repeat(32)}`;
const COMMITMENT_HEX = `0x${"33".repeat(32)}`;
const tempRoots: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".pr012p-test-"));
  fs.mkdirSync(dir, { recursive: true });
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

function writeZkeys(root: string, overrides: { merkle?: string; withdraw?: string } = {}) {
  const artifactDir = path.join(root, "data/circuit-artifacts");
  const circuitBase = path.join(root, "repo/circuits");
  const merklePath = path.join(artifactDir, "merkle_batch_update/merkle_batch_update.zkey");
  const withdrawPath = path.join(artifactDir, "withdraw/withdraw.zkey");
  writeFile(merklePath, overrides.merkle ?? "merkle fixture");
  writeFile(withdrawPath, overrides.withdraw ?? "withdraw fixture");
  return {
    artifactDir,
    circuitBase,
    merklePath,
    withdrawPath,
    merkleHash: sha256(merklePath),
    withdrawHash: sha256(withdrawPath),
  };
}

function baseEnv(root: string): Record<string, string> {
  const zkeys = writeZkeys(root);
  return {
    BRIDGE_DAEMON_MODE: "paper",
    BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "false",
    BRIDGE_CIRCUIT_ARTIFACT_DIR: zkeys.artifactDir,
    PR012P_CIRCUIT_BASE: zkeys.circuitBase,
    PR012P_EXPECTED_MERKLE_ZKEY_SHA256: zkeys.merkleHash,
    PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256: zkeys.withdrawHash,
    PR012P_SKIP_WALLET_RPC: "true",
    BRIDGE_NOTE_STATE_BACKUP_DIR: path.join(root, "data/white-bridge-note-state"),
    BRIDGE_RESULTS_DIR: path.join(root, "data/bridge-results"),
    PR012B_DESTINATION_MESSAGE_HASH: DESTINATION_HASH,
    PR012B_SOURCE_MESSAGE_HASH: SOURCE_HASH,
  };
}

function writeReports(env: Record<string, string>, nowMs: number): void {
  const notePath = path.join(env.BRIDGE_NOTE_STATE_BACKUP_DIR, `${DESTINATION_HASH.slice(2)}.bridge-note-state.json`);
  writeFile(notePath, JSON.stringify({ ok: true }));
  fs.mkdirSync(env.BRIDGE_RESULTS_DIR, { recursive: true });
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
      evidenceSha256: null,
    }, null, 2)
  );
  writeFile(
    path.join(env.BRIDGE_RESULTS_DIR, `preflight-${DESTINATION_HASH.slice(2)}.json`),
    JSON.stringify({
      ok: true,
      readiness: "ready",
      generatedAt: new Date(nowMs).toISOString(),
      route: "base-sepolia->solana-devnet",
      sourceBridgeOutHash: SOURCE_HASH,
      destinationBridgeMintHash: DESTINATION_HASH,
      destinationCommitment: COMMITMENT_HEX,
      artifacts: { ok: true },
      noteState: { ok: true },
      pending: { ok: true },
      wallet: { ok: true },
      reportPath: null,
      transactionsSubmitted: false,
      secretsPrinted: false,
    }, null, 2)
  );
  writeFile(
    path.join(env.BRIDGE_RESULTS_DIR, `recovery-snapshot-${DESTINATION_HASH.slice(2)}.json`),
    JSON.stringify({
      ok: true,
      generatedAt: new Date(nowMs).toISOString(),
      destinationMessageHash: DESTINATION_HASH,
      sourceMessageHash: SOURCE_HASH,
      readiness: "already_withdrawn_spent_nullifier",
      recommendedAction: "no_action_already_complete",
      transactionsSubmitted: false,
      proofsGenerated: false,
      secretsPrinted: false,
    }, null, 2)
  );
}

function assertNoSecrets(value: unknown): void {
  const rendered = JSON.stringify(value);
  for (const secret of ["destSecret", "destNullifier", "privateKey", "operatorToken", "witness"]) {
    assert.ok(!rendered.includes(secret), `rendered output contains ${secret}`);
  }
}

async function run(): Promise<void> {
  {
    const root = tmpDir();
    const zkeys = writeZkeys(root);
    const result = bootstrapZkeys({
      env: {
        BRIDGE_CIRCUIT_ARTIFACT_DIR: zkeys.artifactDir,
        PR012P_CIRCUIT_BASE: zkeys.circuitBase,
        PR012P_EXPECTED_MERKLE_ZKEY_SHA256: zkeys.merkleHash,
        PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256: zkeys.withdrawHash,
      },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.merkleZkey.hashMatches, true);
    assert.strictEqual(result.withdrawZkey.hashMatches, true);
    assert.strictEqual(result.merkleZkey.linkTargetMatches, true);
    assert.strictEqual(result.withdrawZkey.linkTargetMatches, true);
    assertNoSecrets(result);
  }

  {
    const root = tmpDir();
    const zkeys = writeZkeys(root);
    fs.unlinkSync(zkeys.merklePath);
    const result = bootstrapZkeys({
      env: {
        BRIDGE_CIRCUIT_ARTIFACT_DIR: zkeys.artifactDir,
        PR012P_CIRCUIT_BASE: zkeys.circuitBase,
        PR012P_EXPECTED_MERKLE_ZKEY_SHA256: zkeys.merkleHash,
        PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256: zkeys.withdrawHash,
      },
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.includes("merkle_zkey_missing"));
  }

  {
    const root = tmpDir();
    const zkeys = writeZkeys(root);
    fs.unlinkSync(zkeys.withdrawPath);
    const result = bootstrapZkeys({
      env: {
        BRIDGE_CIRCUIT_ARTIFACT_DIR: zkeys.artifactDir,
        PR012P_CIRCUIT_BASE: zkeys.circuitBase,
        PR012P_EXPECTED_MERKLE_ZKEY_SHA256: zkeys.merkleHash,
        PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256: zkeys.withdrawHash,
      },
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.includes("withdraw_zkey_missing"));
  }

  {
    const root = tmpDir();
    const zkeys = writeZkeys(root);
    const result = bootstrapZkeys({
      env: {
        BRIDGE_CIRCUIT_ARTIFACT_DIR: zkeys.artifactDir,
        PR012P_CIRCUIT_BASE: zkeys.circuitBase,
        PR012P_EXPECTED_MERKLE_ZKEY_SHA256: "0".repeat(64),
        PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256: zkeys.withdrawHash,
      },
    });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.includes("merkle_zkey_hash_mismatch"));
  }

  {
    const root = tmpDir();
    const zkeys = writeZkeys(root);
    fs.rmSync(path.join(zkeys.circuitBase, "merkle_batch_update"), { recursive: true, force: true });
    fs.rmSync(path.join(zkeys.circuitBase, "withdraw"), { recursive: true, force: true });
    const result = bootstrapZkeys({
      env: {
        BRIDGE_CIRCUIT_ARTIFACT_DIR: zkeys.artifactDir,
        PR012P_CIRCUIT_BASE: zkeys.circuitBase,
        PR012P_EXPECTED_MERKLE_ZKEY_SHA256: zkeys.merkleHash,
        PR012P_EXPECTED_WITHDRAW_ZKEY_SHA256: zkeys.withdrawHash,
      },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.lstatSync(result.merkleZkey.linkPath).isSymbolicLink(), true);
    assert.strictEqual(fs.lstatSync(result.withdrawZkey.linkPath).isSymbolicLink(), true);
  }

  {
    const root = tmpDir();
    const zkeys = writeZkeys(root);
    const tmpArtifactDir = path.join("/tmp", path.basename(zkeys.artifactDir));
    fs.mkdirSync(tmpArtifactDir, { recursive: true });
    const result = await runOperatorPrereq({
      env: {
        ...baseEnv(root),
        BRIDGE_CIRCUIT_ARTIFACT_DIR: tmpArtifactDir,
      },
    });
    assert.strictEqual(result.readiness, "blocked_zkeys");
    assert.ok(result.zkeys.errors.includes("artifact_dir_tmp_blocked"));
  }

  {
    const root = tmpDir();
    const env = baseEnv(root);
    fs.mkdirSync(env.BRIDGE_RESULTS_DIR, { recursive: true });
    const result = await runOperatorPrereq({ env });
    assert.strictEqual(result.readiness, "blocked_note_state");
  }

  {
    const root = tmpDir();
    const env = { ...baseEnv(root), BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT: "true" };
    writeReports(env, Date.now());
    const result = await runOperatorPrereq({ env });
    assert.strictEqual(result.readiness, "blocked_safe_mode");
  }

  {
    const root = tmpDir();
    const nowMs = Date.now();
    const env = baseEnv(root);
    writeReports(env, nowMs);
    const result = await runOperatorPrereq({ env, nowMs });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.readiness, "ready");
    assert.strictEqual(result.recommendedAction, "run_dry_run_job");
    assert.strictEqual(result.leafIndexEvidence.ok, true);
    assert.strictEqual(result.preflight.ok, true);
    assert.strictEqual(result.recoverySnapshot.ok, true);
    assertNoSecrets(result);
  }

  console.log(JSON.stringify({ ok: true, status: "hosted_operator_prereq_tests_passed" }, null, 2));
}

(async () => {
  try {
    await run();
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    for (const dir of tempRoots) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
})();
