import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  buildLeafIndexEvidence,
  leafIndexEvidencePathFor,
  readLeafIndexEvidence,
} from "./hosted-leaf-index-evidence";
import type { HostedSettleWithdrawPreflight } from "./hosted-settle-withdraw-preflight";

const DESTINATION_HASH = `0x${"22".repeat(32)}`;
const SOURCE_HASH = `0x${"11".repeat(32)}`;
const COMMITMENT_HEX = `0x${"33".repeat(32)}`;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr012o-leaf-index-test-"));
}

function baseEnv(dir: string): Record<string, string> {
  return {
    BRIDGE_RESULTS_DIR: dir,
    BRIDGE_OPERATOR_JOB_INDEX_PATH: path.join(dir, "operator-job-index.json"),
    PR012B_DESTINATION_MESSAGE_HASH: DESTINATION_HASH,
    PR012B_SOURCE_MESSAGE_HASH: SOURCE_HASH,
    BRIDGE_LEAF_INDEX_DESTINATION_COMMITMENT: COMMITMENT_HEX,
  };
}

function writeResult(dir: string, evidence: Record<string, unknown> = {}): string {
  const resultPath = path.join(dir, `settle-withdraw-${DESTINATION_HASH.slice(2)}.json`);
  fs.writeFileSync(
    resultPath,
    JSON.stringify({
      verifyResult: {
        ok: true,
        evidence: {
          sourceBridgeOutHash: SOURCE_HASH,
          destinationBridgeMintHash: DESTINATION_HASH,
          destinationCommitment: COMMITMENT_HEX,
          settleTx: "settleTx",
          nextLeafIndexBefore: 9,
          nextLeafIndexAfter: 10,
          pendingBeforeTargetSettle: 0,
          oldRoot: "oldRoot",
          newRoot: "newRoot",
          ...evidence,
        },
      },
    }, null, 2),
    { mode: 0o600 }
  );
  return resultPath;
}

function preflight(overrides: Partial<HostedSettleWithdrawPreflight> = {}): HostedSettleWithdrawPreflight {
  return {
    ok: true,
    readiness: "ready",
    generatedAt: new Date().toISOString(),
    route: "base-sepolia->solana-devnet",
    sourceBridgeOutHash: SOURCE_HASH,
    destinationBridgeMintHash: DESTINATION_HASH,
    destinationCommitment: COMMITMENT_HEX,
    artifacts: {} as any,
    noteState: {} as any,
    pending: {
      ok: true,
      checked: true,
      status: "ready",
      poolConfig: null,
      merkleTree: null,
      pendingBuffer: null,
      assetVault: null,
      commitmentIndex: null,
      consumedMessage: null,
      consumedPdaExists: true,
      targetPending: true,
      targetAlreadySettled: false,
      targetPendingIndex: 2,
      pendingCount: 3,
      fifoPrefixRequired: false,
      fifoPrefixCount: 0,
      nextLeafIndex: 9,
      currentMerkleRoot: "rootBefore",
      errors: [],
    },
    wallet: {} as any,
    reportPath: null,
    transactionsSubmitted: false,
    secretsPrinted: false,
    ...overrides,
  };
}

function writePreflight(dir: string, value = preflight()): void {
  fs.writeFileSync(path.join(dir, `preflight-${DESTINATION_HASH.slice(2)}.json`), JSON.stringify(value, null, 2), { mode: 0o600 });
}

async function run(): Promise<void> {
  {
    const dir = tmpDir();
    writeResult(dir);
    const result = buildLeafIndexEvidence({ env: baseEnv(dir), nowMs: 1 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.evidence?.evidenceSource, "settlement_result");
    assert.strictEqual(result.evidence?.leafIndex, 9);
    assert.ok(result.evidencePath && fs.existsSync(result.evidencePath));
    assert.ok(result.evidenceSha256);
    assert.ok(!JSON.stringify(result).includes("destSecret"));
    assert.ok(!JSON.stringify(result).includes("destNullifier"));
  }

  {
    const dir = tmpDir();
    writePreflight(dir);
    const result = buildLeafIndexEvidence({ env: baseEnv(dir), nowMs: 1 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.evidence?.evidenceSource, "pre_settlement_snapshot");
    assert.strictEqual(result.evidence?.leafIndex, 11);
    assert.strictEqual(result.evidence?.pendingIndexBeforeSettlement, 2);
  }

  {
    const dir = tmpDir();
    const result = buildLeafIndexEvidence({ env: baseEnv(dir), nowMs: 1 });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.status, "blocked_leaf_index_evidence_missing");
  }

  {
    const dir = tmpDir();
    writeResult(dir, { destinationBridgeMintHash: `0x${"66".repeat(32)}` });
    const result = buildLeafIndexEvidence({ env: baseEnv(dir), nowMs: 1 });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.includes("destination_hash_mismatch"));
  }

  {
    const dir = tmpDir();
    writeResult(dir, { destinationCommitment: `0x${"77".repeat(32)}` });
    const result = buildLeafIndexEvidence({ env: baseEnv(dir), nowMs: 1 });
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.includes("destination_commitment_mismatch"));
  }

  {
    const dir = tmpDir();
    const env = {
      ...baseEnv(dir),
      BRIDGE_LEAF_INDEX_MANUAL_REVIEW: "true",
      BRIDGE_LEAF_INDEX: "14",
      BRIDGE_LEAF_INDEX_DESTINATION_HASH: DESTINATION_HASH,
      BRIDGE_LEAF_INDEX_DESTINATION_COMMITMENT: COMMITMENT_HEX,
      BRIDGE_LEAF_INDEX_PENDING_INDEX_BEFORE: "0",
    };
    const result = buildLeafIndexEvidence({ env, nowMs: 1 });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.evidence?.evidenceSource, "manual_operator_review");
    assert.strictEqual(result.evidence?.leafIndex, 14);
    const read = readLeafIndexEvidence({
      destinationHash: DESTINATION_HASH,
      env,
      sourceHash: SOURCE_HASH,
      destinationCommitment: COMMITMENT_HEX,
    });
    assert.strictEqual(read.errors.length, 0);
    assert.strictEqual(read.evidence?.leafIndex, 14);
  }

  {
    const dir = tmpDir();
    const evidencePath = leafIndexEvidencePathFor(DESTINATION_HASH, baseEnv(dir));
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(
      evidencePath,
      JSON.stringify({
        destinationMessageHash: `0x${"66".repeat(32)}`,
        sourceMessageHash: SOURCE_HASH,
        destinationCommitment: COMMITMENT_HEX,
        settlementTx: null,
        leafIndex: 9,
        pendingIndexBeforeSettlement: null,
        merkleNextLeafIndexBefore: null,
        merkleNextLeafIndexAfter: null,
        rootBefore: null,
        rootAfter: null,
        evidenceSource: "manual_operator_review",
        createdAt: new Date().toISOString(),
      }, null, 2)
    );
    const read = readLeafIndexEvidence({
      destinationHash: DESTINATION_HASH,
      env: baseEnv(dir),
      sourceHash: SOURCE_HASH,
      destinationCommitment: COMMITMENT_HEX,
    });
    assert.ok(read.errors.includes("leaf_index_destination_hash_mismatch"));
    assert.strictEqual(read.evidence, null);
  }

  console.log(JSON.stringify({ ok: true, status: "hosted_leaf_index_evidence_tests_passed" }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
