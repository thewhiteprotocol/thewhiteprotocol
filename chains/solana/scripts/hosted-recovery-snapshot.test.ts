import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";

import { runRecoverySnapshot } from "./hosted-recovery-snapshot";
import type { HostedSettleWithdrawPreflight } from "./hosted-settle-withdraw-preflight";
import { deriveSpentNullifierPdaFromNoteState } from "./hosted-spent-nullifier";

const DESTINATION_HASH = `0x${"22".repeat(32)}`;
const SOURCE_HASH = `0x${"11".repeat(32)}`;
const COMMITMENT_HEX = `0x${"33".repeat(32)}`;
const COMMITMENT_DECIMAL = BigInt(COMMITMENT_HEX).toString();
const PROGRAM_ID = "DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD";
const OWNER = PROGRAM_ID;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr012k-snapshot-test-"));
}

function noteStatePath(dir: string): string {
  return path.join(dir, "note-state.json");
}

function writeNoteState(dir: string): void {
  fs.writeFileSync(
    noteStatePath(dir),
    JSON.stringify(
      {
        sourceBridgeOutHash: SOURCE_HASH,
        destinationBridgeMintHash: DESTINATION_HASH,
        destinationCommitment: COMMITMENT_HEX,
        destinationAmount: "1000000",
        solanaAssetId: `0x${"44".repeat(32)}`,
        destSecret: "123456789",
        destNullifier: "987654321",
      },
      null,
      2
    )
  );
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
    pending: {} as any,
    wallet: {} as any,
    reportPath: null,
    transactionsSubmitted: false,
    secretsPrinted: false,
    ...overrides,
  };
}

function writePreflight(dir: string, value = preflight()): void {
  fs.writeFileSync(path.join(dir, `preflight-${DESTINATION_HASH.slice(2)}.json`), JSON.stringify(value, null, 2));
}

function writeJobIndex(dir: string, job: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, "operator-job-index.json"),
    JSON.stringify({ version: 1, jobs: [job] }, null, 2),
    { mode: 0o600 }
  );
}

function writeLeafIndexEvidence(dir: string, leafIndex = 9): void {
  fs.writeFileSync(
    path.join(dir, `leaf-index-${DESTINATION_HASH.slice(2)}.json`),
    JSON.stringify(
      {
        destinationMessageHash: DESTINATION_HASH,
        sourceMessageHash: SOURCE_HASH,
        destinationCommitment: COMMITMENT_HEX,
        settlementTx: "settleTx",
        leafIndex,
        pendingIndexBeforeSettlement: 0,
        merkleNextLeafIndexBefore: leafIndex,
        merkleNextLeafIndexAfter: leafIndex + 1,
        rootBefore: "rootBefore",
        rootAfter: "rootAfter",
        evidenceSource: "settlement_result",
        createdAt: new Date().toISOString(),
        evidenceSha256: null,
      },
      null,
      2
    ),
    { mode: 0o600 }
  );
}

function baseEnv(dir: string): Record<string, string> {
  return {
    PR012B_DESTINATION_MESSAGE_HASH: DESTINATION_HASH,
    PR012B_SOURCE_MESSAGE_HASH: SOURCE_HASH,
    PR012B_SUBMIT_TX: "submitTx",
    BASE_TO_SOLANA_BRIDGE_STATE_PATH: noteStatePath(dir),
    BRIDGE_RESULTS_DIR: dir,
    BRIDGE_OPERATOR_JOB_INDEX_PATH: path.join(dir, "operator-job-index.json"),
    PROGRAM_ID,
    POOL_CONFIG: "DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF",
  };
}

function commitmentBytes(hex = COMMITMENT_HEX): number[] {
  return Array.from(Buffer.from(hex.slice(2), "hex"));
}

function mockReader(options: {
  pendingIndex?: number;
  commitmentIndexExists?: boolean;
  submitErr?: unknown;
  submitFound?: boolean;
  spentNullifierExists?: boolean;
} = {}) {
  const pendingIndex = options.pendingIndex ?? 0;
  let accountReads = 0;
  const deposits = pendingIndex < 0
    ? []
    : [
        ...Array.from({ length: pendingIndex }, (_, i) => ({ commitment: Array(32).fill(i + 1) })),
        { commitment: commitmentBytes() },
      ];
  return {
    async getSignature() {
      return {
        provided: true,
        signature: "submitTx",
        found: options.submitFound ?? true,
        confirmationStatus: options.submitFound === false ? null : "confirmed",
        slot: options.submitFound === false ? null : 1,
        err: options.submitErr ?? null,
        blockTime: 1,
        logsPreview: ["Program log: redacted"],
      };
    },
    async getAccount(address: any) {
      accountReads += 1;
      const key = address.toBase58();
      const isCommitmentIndexRead = accountReads === 7;
      const isSpentNullifierRead = accountReads === 8;
      const exists = isCommitmentIndexRead && options.commitmentIndexExists !== undefined
        ? options.commitmentIndexExists
        : isSpentNullifierRead
          ? options.spentNullifierExists === true
        : true;
      return {
        address: key,
        exists,
        owner: OWNER,
        expectedOwnerMatch: true,
      };
    },
    async fetchPoolConfig() {
      return { authority: { toBase58: () => "authority" } };
    },
    async fetchMerkleTree() {
      return {
        nextLeafIndex: 9,
        currentRoot: Array(32).fill(5),
      };
    },
    async fetchPendingBuffer() {
      return {
        totalPending: deposits.length,
        deposits,
      };
    },
  };
}

function mockReaderWithSpent() {
  const reader = mockReader({ pendingIndex: -1, commitmentIndexExists: true, spentNullifierExists: true });
  return {
    ...reader,
    async getAccount(address: any) {
      return {
        address: address.toBase58(),
        exists: true,
        owner: OWNER,
        expectedOwnerMatch: true,
      };
    },
  };
}

function mockReaderSpentRpcError() {
  const reader = mockReader({ pendingIndex: 0 });
  let accountReads = 0;
  return {
    ...reader,
    async getAccount(address: any) {
      accountReads += 1;
      if (accountReads === 8) throw new Error("rpc_spent_nullifier_lookup_failed");
      return reader.getAccount(address);
    },
  };
}

async function run(): Promise<void> {
  {
    const dir = tmpDir();
    writeNoteState(dir);
    const derivation = await deriveSpentNullifierPdaFromNoteState({
      noteStatePath: noteStatePath(dir),
      poolConfig: new PublicKey(baseEnv(dir).POOL_CONFIG),
      programId: new PublicKey(PROGRAM_ID),
      leafIndex: 9,
    });
    assert.strictEqual(derivation.derived, true);
    assert.ok(derivation.spentNullifierPda);
    assert.ok(!JSON.stringify(derivation).includes("123456789"));
    assert.ok(!JSON.stringify(derivation).includes("987654321"));
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader({ pendingIndex: 0 }) as any });
    assert.strictEqual(snapshot.pdas.consumedMessage?.exists, true);
    assert.strictEqual(snapshot.pending.targetPendingIndex, 0);
    assert.strictEqual(snapshot.readiness, "ready_for_resume");
    assert.strictEqual(snapshot.recommendedAction, "resume_settlement");
    assert.strictEqual(snapshot.transactionsSubmitted, false);
    assert.strictEqual(snapshot.proofsGenerated, false);
    assert.strictEqual(snapshot.spentNullifier.derived, true);
    assert.strictEqual(snapshot.spentNullifier.exists, false);
    assert.strictEqual(snapshot.spentNullifier.withdrawAlreadyConsumed, false);
    assert.ok(snapshot.reportPath && fs.existsSync(snapshot.reportPath));
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader({ pendingIndex: 2 }) as any });
    assert.strictEqual(snapshot.pending.fifoPrefixRequired, true);
    assert.strictEqual(snapshot.pending.fifoPrefixCount, 2);
    assert.strictEqual(snapshot.recommendedAction, "settle_fifo_prefix");
  }

  {
    const dir = tmpDir();
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader() as any });
    assert.strictEqual(snapshot.readiness, "blocked_note_state_missing");
    assert.strictEqual(snapshot.recommendedAction, "restore_note_state");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    const state = JSON.parse(fs.readFileSync(noteStatePath(dir), "utf8"));
    delete state.destNullifier;
    fs.writeFileSync(noteStatePath(dir), JSON.stringify(state, null, 2));
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader() as any });
    assert.strictEqual(snapshot.spentNullifier.derived, false);
    assert.strictEqual(snapshot.readiness, "blocked_note_state_invalid");
    assert.ok(!JSON.stringify(snapshot).includes("123456789"));
  }

  {
    const dir = tmpDir();
    fs.writeFileSync(noteStatePath(dir), "{not-json");
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader() as any });
    assert.strictEqual(snapshot.spentNullifier.derived, false);
    assert.strictEqual(snapshot.readiness, "blocked_note_state_invalid");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir, preflight({ generatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader() as any });
    assert.strictEqual(snapshot.readiness, "blocked_preflight_stale");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader({ submitErr: { InstructionError: [0, "Custom"] } }) as any });
    assert.strictEqual(snapshot.readiness, "tx_failed");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const resultPath = path.join(dir, "settlement-result.json");
    fs.writeFileSync(resultPath, JSON.stringify({ verifyResult: { evidence: { nextLeafIndexBefore: 9 } } }));
    writeJobIndex(dir, {
      jobId: "job",
      destinationMessageHash: DESTINATION_HASH,
      status: "settlement_confirmed",
      settlementTx: "settleTx",
      withdrawTx: null,
      resultReportPath: resultPath,
    });
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader({ pendingIndex: -1, commitmentIndexExists: true }) as any });
    assert.strictEqual(snapshot.jobIndex.latestPhase, "settlement_confirmed");
    assert.strictEqual(snapshot.recommendedAction, "resume_withdraw");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const resultPath = path.join(dir, "settle-withdraw.json");
    fs.writeFileSync(
      resultPath,
      JSON.stringify({ verifyResult: { evidence: { spentNullifier: "11111111111111111111111111111111", nextLeafIndexBefore: 9 } } })
    );
    writeJobIndex(dir, {
      jobId: "job",
      destinationMessageHash: DESTINATION_HASH,
      status: "withdraw_confirmed",
      settlementTx: "settleTx",
      withdrawTx: "withdrawTx",
      resultReportPath: resultPath,
    });
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReaderWithSpent() as any });
    assert.strictEqual(snapshot.readiness, "already_withdrawn_spent_nullifier");
    assert.strictEqual(snapshot.recommendedAction, "no_action_already_complete");
    assert.strictEqual(snapshot.spentNullifier.withdrawAlreadyConsumed, true);
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    writeLeafIndexEvidence(dir, 9);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader({ pendingIndex: -1, commitmentIndexExists: true }) as any });
    assert.strictEqual(snapshot.leafIndexEvidence.found, true);
    assert.strictEqual(snapshot.leafIndexEvidence.leafIndex, 9);
    assert.strictEqual(snapshot.spentNullifier.derived, true);
    assert.strictEqual(snapshot.spentNullifier.exists, false);
    assert.strictEqual(snapshot.recommendedAction, "resume_withdraw");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReaderSpentRpcError() as any });
    assert.strictEqual(snapshot.readiness, "blocked_spent_nullifier_unknown");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader({ pendingIndex: -1, commitmentIndexExists: false }) as any });
    assert.strictEqual(snapshot.readiness, "blocked_pending_not_found");
  }

  {
    const dir = tmpDir();
    writeNoteState(dir);
    writePreflight(dir);
    const snapshot = await runRecoverySnapshot({ env: baseEnv(dir), reader: mockReader({ submitFound: false }) as any });
    assert.strictEqual(snapshot.readiness, "tx_unknown");
    const rendered = JSON.stringify(snapshot);
    assert.ok(!rendered.includes("123456789"));
    assert.ok(!rendered.includes("987654321"));
  }

  console.log(JSON.stringify({ ok: true, status: "hosted_recovery_snapshot_tests_passed" }, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
