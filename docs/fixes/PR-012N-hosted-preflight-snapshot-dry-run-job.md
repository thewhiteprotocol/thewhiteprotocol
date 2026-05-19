# PR-012N: Hosted Preflight, Recovery Snapshot, and Dry-Run Job

## Summary

PR-012N ran the hosted read-only settlement/withdraw operator flow on Render for the PR-012F Base Sepolia -> Solana Devnet destination message. The flow used the durable Render disk at `/data`, verified persistent zkeys and destination note-state, exported non-secret reports, and ran the settle/withdraw job wrapper in dry-run mode only.

No bridge accept, settlement, withdraw, or proof-generation transaction was submitted by this PR.

## PR-012M Status

PR-012M added direct spent-nullifier PDA derivation from validated destination note-state using:

```text
Poseidon(Poseidon(destNullifier, destSecret), leafIndex)
```

The derivation helper does not print `destSecret`, `destNullifier`, witness data, or the raw nullifier hash. Reports expose only non-secret PDA/status metadata when the leaf index is known.

## Hosted Env Check

Render service:

```text
srv-d7ge2mk71suc73a5gs5g
```

The hosted runtime was redeployed to commit:

```text
6d2676b
```

Safe daemon environment was confirmed before the read-only flow:

```text
BRIDGE_DAEMON_MODE=paper
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false
```

Durable inputs were present under:

```text
/data/white-bridge-note-state
/data/circuit-artifacts
/data/bridge-results
```

Because Render redeploys reset the ephemeral repo filesystem, the zkey symlinks were recreated after deploy:

```text
circuits/merkle_batch_update/build/merkle_batch_update.zkey -> /data/circuit-artifacts/merkle_batch_update/merkle_batch_update.zkey
circuits/withdraw/build/withdraw.zkey -> /data/circuit-artifacts/withdraw/withdraw.zkey
```

## Preflight Result

Command:

```bash
cd chains/solana
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
BRIDGE_RESULTS_DIR=/data/bridge-results \
PROGRAM_ID=DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD \
POOL_CONFIG=DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF \
PR012B_SOURCE_MESSAGE_HASH=0xa5c21fa82bb63e891ad38b582cf60d6a6a422f9eecc06bf4bf60c9f44f6f58ef \
PR012B_DESTINATION_MESSAGE_HASH=0xb8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049 \
BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT=0x0e9b7af685043b3ae074863ef81d6c3913ed766d66f356107457f02fe7bc18da \
BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT=1000000 \
npm run bridge:preflight:settle-withdraw
```

Result:

```text
ok: true
readiness: ready
reportPath: /data/bridge-results/preflight-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
preflightReportSha256: ac2dff2894260fcb1b4326dc0238179f4dcbda6c49bf7c051390adbe705f1b18
transactionsSubmitted: false
secretsPrinted: false
```

Artifact checks:

```text
merkle_batch_update.zkey hash: 107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9
withdraw.zkey hash: cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0
zkeys under persistent disk: true
wasm files present: true
```

Note-state checks passed for the exact source hash, destination hash, destination commitment, destination amount, and asset. The report included only `hasDestSecret=true` and `hasDestNullifier=true`; secret values were not printed.

Pending/FIFO result:

```text
status: already_settled
targetPending: false
targetAlreadySettled: true
pendingCount: 0
nextLeafIndex: 10
```

Wallet authority result:

```text
walletPublicKey: 83mQrkhgXw1P7P5BAJ7UoHVRT7XNzW6PA8wfpoKi1uuw
expectedPoolAuthority: 83mQrkhgXw1P7P5BAJ7UoHVRT7XNzW6PA8wfpoKi1uuw
poolAuthorityMatches: true
```

## Recovery Snapshot Result

Command:

```bash
cd chains/solana
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
BRIDGE_RESULTS_DIR=/data/bridge-results \
BRIDGE_OPERATOR_JOB_INDEX_PATH=/data/bridge-results/operator-job-index.json \
BASE_TO_SOLANA_BRIDGE_STATE_PATH=/data/white-bridge-note-state/b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.bridge-note-state.json \
PROGRAM_ID=DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD \
POOL_CONFIG=DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF \
PR012B_SOURCE_MESSAGE_HASH=0xa5c21fa82bb63e891ad38b582cf60d6a6a422f9eecc06bf4bf60c9f44f6f58ef \
PR012B_DESTINATION_MESSAGE_HASH=0xb8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049 \
PR012B_SUBMIT_TX=Bacq5XuVdfaZFtQrwSE6x5hhMGFtvuS8ggZAJFGsfiEXMvUbBzdCgC8jTEtLa8nWCaUpFouaUEgLsPptUvk8fsv \
npm run bridge:recovery:snapshot
```

Result:

```text
ok: false
readiness: blocked_spent_nullifier_unknown
recommendedAction: operator_review_required
reportPath: /data/bridge-results/recovery-snapshot-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
recoverySnapshotSha256: 1cde8163d6a9bbafca25e6c58e0efc7ab2dc9892170e0211cba6d4f34905c537
transactionsSubmitted: false
proofsGenerated: false
secretsPrinted: false
```

Submit transaction check:

```text
signature: Bacq5XuVdfaZFtQrwSE6x5hhMGFtvuS8ggZAJFGsfiEXMvUbBzdCgC8jTEtLa8nWCaUpFouaUEgLsPptUvk8fsv
found: true
confirmationStatus: finalized
slot: 462640069
err: null
```

PDA checks:

```text
consumedMessage exists: true
frozenMessage exists: false
commitmentIndex exists: true
pendingBuffer exists: true
poolConfig exists: true
merkleTree exists: true
assetVault exists: true
```

## Spent-Nullifier PDA Result

The snapshot could not derive the expected spent-nullifier PDA because the target was already settled and no prior job/result evidence supplied the target leaf index:

```text
spentNullifier.derived: false
spentNullifier.status: missing_field
spentNullifier.error: leaf_index_missing
spentNullifierPda: null
spentNullifier.exists: null
withdrawAlreadyConsumed: false
```

This is the expected remaining PR-012M limitation for already-settled targets. The snapshot blocked safely instead of guessing the leaf index.

## Dry-Run Job Wrapper Result

Command:

```bash
cd chains/solana
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SETTLE_WITHDRAW_EXECUTE=false \
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
BRIDGE_RESULTS_DIR=/data/bridge-results \
BRIDGE_OPERATOR_JOB_INDEX_PATH=/data/bridge-results/operator-job-index.json \
PROGRAM_ID=DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD \
POOL_CONFIG=DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF \
PR012B_SOURCE_MESSAGE_HASH=0xa5c21fa82bb63e891ad38b582cf60d6a6a422f9eecc06bf4bf60c9f44f6f58ef \
PR012B_DESTINATION_MESSAGE_HASH=0xb8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049 \
npm run bridge:job:settle-withdraw
```

Result:

```text
ok: false
status: blocked
readiness: blocked_recovery_snapshot_readiness
wouldExecute: false
transactionsSubmittedByWrapper: false
secretsPrinted: false
jobIndexPath: /data/bridge-results/operator-job-index.json
```

The wrapper bound the reports:

```text
preflightReportSha256: ac2dff2894260fcb1b4326dc0238179f4dcbda6c49bf7c051390adbe705f1b18
recoverySnapshotSha256: 1cde8163d6a9bbafca25e6c58e0efc7ab2dc9892170e0211cba6d4f34905c537
```

The wrapper blocked for the exact safe reasons:

```text
recovery_snapshot_readiness_blocked:blocked_spent_nullifier_unknown
recovery_snapshot_spent_nullifier_not_derived
recovery_snapshot_recommended_action_not_permitted:operator_review_required
```

## Proof No Transactions Were Submitted

The hosted preflight, recovery snapshot, and dry-run job wrapper all reported non-mutating status:

```text
preflight.transactionsSubmitted: false
snapshot.transactionsSubmitted: false
snapshot.proofsGenerated: false
job.transactionsSubmittedByWrapper: false
job.execute: false
job.wouldExecute: false
```

No `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` command was run.

## Commands Run

Render:

- `npm run bridge:preflight:settle-withdraw`
- `npm run bridge:recovery:snapshot`
- `npm run bridge:job:settle-withdraw` with `BRIDGE_SETTLE_WITHDRAW_EXECUTE=false`

Codespace validation:

- `cd chains/solana && npm run bridge:test-preflight:settle-withdraw`
- `cd chains/solana && npm run bridge:test-recovery:snapshot`
- `cd chains/solana && npm run bridge:test-job:settle-withdraw`

## Tests Run

The hosted operator automation tests passed in Codespace after the dry-run recovery-snapshot binding patch:

```text
hosted_settle_withdraw_preflight_tests_passed
hosted_recovery_snapshot_tests_passed
hosted_settle_withdraw_job_tests_passed
```

Rust/SBF and relayer regression suites were not rerun for PR-012N because this PR only recorded hosted read-only evidence and a job-wrapper dry-run binding fix. The previous PR-012M validation remains the most recent full suite:

```text
Solana Rust tests: 115 passed
SBF build: passed
relayer tests: 25 suites / 354 tests
relayer typecheck/build: passed
watcher smoke/report: passed
```

## Remaining Limitations

- Already-settled targets still require trusted leaf-index evidence before the snapshot can derive the expected spent-nullifier PDA.
- The PR-012F target is already settled and withdrawn, but this Render job index had no prior result entry with `nextLeafIndexBefore`, so PR-012N correctly blocked as `blocked_spent_nullifier_unknown`.
- Render redeploys reset repo-local symlinks, so zkey symlinks must be recreated after deploy unless startup automation is added.

## Next Recommended PR

PR-012O should persist or reconstruct settlement leaf-index evidence for already-settled targets so the live recovery snapshot can derive and check the spent-nullifier PDA without relying on manual prior result files.
