import * as assert from "assert";
import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  checkArtifacts,
  checkNoteState,
  checkWalletAuthority,
  determineReadiness,
  planFifoFromPending,
} from "./hosted-settle-withdraw-preflight";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pr012g-preflight-test-"));
}

function sha256(filePath: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function writeArtifactFixture(root: string): { circuitBase: string; artifactDir: string; merkleHash: string; withdrawHash: string } {
  const circuitBase = path.join(root, "circuits");
  const artifactDir = path.join(root, "artifact-store");
  const merklePersistent = path.join(artifactDir, "merkle_batch_update/merkle_batch_update.zkey");
  const withdrawPersistent = path.join(artifactDir, "withdraw/withdraw.zkey");
  const merkleLink = path.join(circuitBase, "merkle_batch_update/build/merkle_batch_update.zkey");
  const withdrawLink = path.join(circuitBase, "withdraw/build/withdraw.zkey");
  writeFile(merklePersistent, "merkle-zkey-fixture");
  writeFile(withdrawPersistent, "withdraw-zkey-fixture");
  writeFile(path.join(circuitBase, "merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm"), "wasm");
  writeFile(path.join(circuitBase, "withdraw/build/withdraw_js/withdraw.wasm"), "wasm");
  fs.mkdirSync(path.dirname(merkleLink), { recursive: true });
  fs.mkdirSync(path.dirname(withdrawLink), { recursive: true });
  fs.symlinkSync(merklePersistent, merkleLink);
  fs.symlinkSync(withdrawPersistent, withdrawLink);
  return {
    circuitBase,
    artifactDir,
    merkleHash: sha256(merklePersistent),
    withdrawHash: sha256(withdrawPersistent),
  };
}

function writeNoteState(filePath: string, overrides: Record<string, unknown> = {}): void {
  writeFile(
    filePath,
    JSON.stringify(
      {
        sourceMessageHash: `0x${"11".repeat(32)}`,
        bridgeMintMessageHash: `0x${"22".repeat(32)}`,
        destinationCommitment: `0x${"33".repeat(32)}`,
        destinationAmount: "1000000",
        solanaAssetId: `0x${"44".repeat(32)}`,
        destSecret: "super-secret-sentinel",
        destNullifier: "super-nullifier-sentinel",
        ...overrides,
      },
      null,
      2
    )
  );
}

function commitment(hexByte: string): number[] {
  return Array.from(Buffer.from(hexByte.repeat(32), "hex"));
}

function run(): void {
  const root = tmpDir();
  const fixture = writeArtifactFixture(root);
  const artifactPass = checkArtifacts({
    PR012G_CIRCUIT_BASE: fixture.circuitBase,
    BRIDGE_CIRCUIT_ARTIFACT_DIR: fixture.artifactDir,
    PR012G_EXPECTED_MERKLE_ZKEY_SHA256: fixture.merkleHash,
    PR012G_EXPECTED_WITHDRAW_ZKEY_SHA256: fixture.withdrawHash,
  });
  assert.strictEqual(artifactPass.ok, true);
  assert.strictEqual(artifactPass.merkleZkey.hashMatches, true);
  assert.strictEqual(artifactPass.withdrawZkey.hashMatches, true);

  const artifactFail = checkArtifacts({
    PR012G_CIRCUIT_BASE: fixture.circuitBase,
    BRIDGE_CIRCUIT_ARTIFACT_DIR: fixture.artifactDir,
    PR012G_EXPECTED_MERKLE_ZKEY_SHA256: "0".repeat(64),
    PR012G_EXPECTED_WITHDRAW_ZKEY_SHA256: fixture.withdrawHash,
  });
  assert.strictEqual(artifactFail.ok, false);
  assert.ok(artifactFail.errors.includes("merkle_zkey_hash_mismatch"));

  fs.unlinkSync(path.join(fixture.artifactDir, "withdraw/withdraw.zkey"));
  const missingZkey = checkArtifacts({
    PR012G_CIRCUIT_BASE: fixture.circuitBase,
    BRIDGE_CIRCUIT_ARTIFACT_DIR: fixture.artifactDir,
    PR012G_EXPECTED_MERKLE_ZKEY_SHA256: fixture.merkleHash,
    PR012G_EXPECTED_WITHDRAW_ZKEY_SHA256: fixture.withdrawHash,
  });
  assert.strictEqual(missingZkey.ok, false);
  assert.ok(missingZkey.errors.includes("withdraw_zkey_missing"));

  const noteDir = path.join(root, "notes");
  const notePath = path.join(noteDir, `${"22".repeat(32)}.bridge-note-state.json`);
  writeNoteState(notePath);
  const notePass = checkNoteState({
    BRIDGE_NOTE_STATE_BACKUP_DIR: noteDir,
    BRIDGE_ALLOW_TMP_NOTE_STATE: "true",
    BRIDGE_NOTE_EXPECTED_SOURCE_HASH: `0x${"11".repeat(32)}`,
    BRIDGE_NOTE_EXPECTED_DESTINATION_HASH: `0x${"22".repeat(32)}`,
    BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT: `0x${"33".repeat(32)}`,
    BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT: "1000000",
    BRIDGE_NOTE_EXPECTED_ASSET_ID: `0x${"44".repeat(32)}`,
  });
  assert.strictEqual(notePass.ok, true);
  assert.strictEqual(notePass.summary.hasDestSecret, true);
  assert.strictEqual(notePass.summary.hasDestNullifier, true);
  assert.ok(!JSON.stringify(notePass).includes("super-secret-sentinel"));
  assert.ok(!JSON.stringify(notePass).includes("super-nullifier-sentinel"));

  const tmpNote = checkNoteState({
    BRIDGE_NOTE_STATE_BACKUP_DIR: os.tmpdir(),
    BRIDGE_NOTE_EXPECTED_DESTINATION_HASH: `0x${"22".repeat(32)}`,
  });
  assert.strictEqual(tmpNote.ok, false);
  assert.strictEqual(tmpNote.checks.backupDirNotTmp, false);

  const missingSecretPath = path.join(noteDir, `${"55".repeat(32)}.bridge-note-state.json`);
  writeNoteState(missingSecretPath, { bridgeMintMessageHash: `0x${"55".repeat(32)}`, destSecret: undefined });
  const missingSecret = checkNoteState({
    BRIDGE_NOTE_STATE_BACKUP_DIR: noteDir,
    BRIDGE_ALLOW_TMP_NOTE_STATE: "true",
    BRIDGE_NOTE_EXPECTED_DESTINATION_HASH: `0x${"55".repeat(32)}`,
  });
  assert.strictEqual(missingSecret.ok, false);
  assert.strictEqual(missingSecret.checks.hasDestSecret, false);

  const target = `0x${"aa".repeat(32)}`;
  const readyPlan = planFifoFromPending({
    pendingData: { deposits: [{ commitment: commitment("aa") }, { commitment: commitment("bb") }] },
    targetCommitmentHex: target,
    nextLeafIndex: 9,
    currentMerkleRoot: `0x${"01".repeat(32)}`,
  });
  assert.strictEqual(readyPlan.ok, true);
  assert.strictEqual(readyPlan.targetPendingIndex, 0);
  assert.strictEqual(readyPlan.fifoPrefixRequired, false);

  const fifoPlan = planFifoFromPending({
    pendingData: { deposits: [{ commitment: commitment("bb") }, { commitment: commitment("aa") }] },
    targetCommitmentHex: target,
  });
  assert.strictEqual(fifoPlan.ok, false);
  assert.strictEqual(fifoPlan.status, "requires_fifo_prefix");
  assert.strictEqual(fifoPlan.fifoPrefixCount, 1);

  assert.strictEqual(
    checkWalletAuthority({ walletPublicKey: "wallet", expectedPoolAuthority: "pool", walletBalanceSol: 1 }).ok,
    false
  );
  assert.strictEqual(
    checkWalletAuthority({ walletPublicKey: "pool", expectedPoolAuthority: "pool", walletBalanceSol: 1 }).ok,
    true
  );

  assert.strictEqual(
    determineReadiness({
      artifactsOk: true,
      noteStateOk: true,
      pendingOk: false,
      pendingStatus: "requires_fifo_prefix",
      walletOk: true,
    }),
    "blocked_fifo"
  );
  assert.strictEqual(
    determineReadiness({
      artifactsOk: true,
      noteStateOk: true,
      pendingOk: true,
      pendingStatus: "ready",
      walletOk: true,
    }),
    "ready"
  );

  console.log(JSON.stringify({ ok: true, status: "hosted_settle_withdraw_preflight_tests_passed" }, null, 2));
}

run();
