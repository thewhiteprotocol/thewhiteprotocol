# PR-012U - Hosted Operator Status, Preflight, Recovery Snapshot, and Dry-Run Job

## Summary

PR-012U ran the hosted Base Sepolia -> Solana Devnet operator readiness flow on Render without enabling execute mode. The service remained in paper mode with live submit disabled. No settlement, withdraw, bridge accept, proof generation, or transaction submission was performed.

The flow confirmed:

- zkey checks pass from persistent `/data/circuit-artifacts`;
- durable note-state exists under `/data/white-bridge-note-state`;
- preflight refreshed to `ready`;
- recovery snapshot refreshed to `already_withdrawn_spent_nullifier`;
- leaf-index evidence exists;
- spent-nullifier PDA is derived and exists;
- dry-run job wrapper reaches `dry_run_ready`;
- all reports are non-secret.

## Render Context

Render service commit:

```text
7f2e46b
```

Startup bootstrap/readiness was already verified before this run:

```text
startup detail: startup_checks_passed
zkeyBootstrapOk: true
merkleZkeyHashOk: true
withdrawZkeyHashOk: true
merkleSymlinkOk: true
withdrawSymlinkOk: true
daemonMode: paper
liveSubmitEnabled: false
transactionsSubmitted: false
proofsGenerated: false
secretsPrinted: false
```

## Operator Status

Command:

```bash
cd chains/solana
npm run bridge:operator:status
```

Result before refreshing reports:

```text
ok=false
final.readiness=blocked_preflight_stale
final.recommendedAction=run_preflight
```

The stale status was expected because the previous preflight and recovery snapshot were older than the freshness window:

```text
preflight.ageSeconds=5270
recovery.ageSeconds=5257
```

Non-secret checks in the same status output passed:

```text
safeMode.ok=true
zkeys.ok=true
noteState.ok=true
leafIndex.ok=true
job.ok=true
transactionsSubmitted=false
proofsGenerated=false
secretsPrinted=false
```

## Preflight Result

Command:

```bash
npm run bridge:preflight:settle-withdraw
```

Result:

```text
ok=true
readiness=ready
reportPath=/data/bridge-results/preflight-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
transactionsSubmitted=false
secretsPrinted=false
```

Zkey checks:

```text
merkle_batch_update.zkey hashMatches=true
withdraw.zkey hashMatches=true
merkle zkey realPath=/data/circuit-artifacts/merkle_batch_update/merkle_batch_update.zkey
withdraw zkey realPath=/data/circuit-artifacts/withdraw/withdraw.zkey
```

Durable note-state:

```text
statePath=/data/white-bridge-note-state/b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.bridge-note-state.json
hasDestSecret=true
hasDestNullifier=true
```

Pending/FIFO:

```text
status=already_settled
targetPending=false
targetAlreadySettled=true
pendingCount=0
nextLeafIndex=10
```

Wallet authority:

```text
poolAuthorityMatches=true
walletPublicKey=83mQrkhgXw1P7P5BAJ7UoHVRT7XNzW6PA8wfpoKi1uuw
```

## Recovery Snapshot Result

Command:

```bash
npm run bridge:recovery:snapshot
```

Result:

```text
ok=true
readiness=already_withdrawn_spent_nullifier
recommendedAction=no_action_already_complete
reportPath=/data/bridge-results/recovery-snapshot-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
transactionsSubmitted=false
proofsGenerated=false
secretsPrinted=false
```

Preflight link:

```text
preflight.readiness=ready
preflight.ageSeconds=2
preflight.destinationHashMatches=true
preflight.sha256=fb4d8d8f13f2c9b24c1ea0c7dd7c4241025df5e9d60ebc24028e49e68fe7e056
```

Leaf-index evidence:

```text
found=true
source=manual_operator_review
leafIndex=9
path=/data/bridge-results/leaf-index-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
sha256=3512ec2af6857640437f5ca584e6a83213f6a057657349411f5c4d90fb6e07db
```

Spent-nullifier PDA:

```text
derived=true
status=derived
spentNullifierPda=6RgG2wnynHP1emf9dfx7HuetcqwXvpU4UzsRrjSHMQPz
exists=true
withdrawAlreadyConsumed=true
```

Destination PDA checks:

```text
consumedMessage.exists=true
commitmentIndex.exists=true
pendingBuffer.exists=true
poolConfig.exists=true
merkleTree.exists=true
assetVault.exists=true
spentNullifier.exists=true
```

## Dry-Run Job Wrapper Result

Command:

```bash
BRIDGE_SETTLE_WITHDRAW_EXECUTE=false npm run bridge:job:settle-withdraw
```

Result:

```text
ok=true
readiness=ready
execute=false
wouldExecute=false
status=dry_run_ready
transactionsSubmittedByWrapper=false
secretsPrinted=false
```

Job binding:

```text
preflightReportSha256=fb4d8d8f13f2c9b24c1ea0c7dd7c4241025df5e9d60ebc24028e49e68fe7e056
recoverySnapshotSha256=d8e90c145670456de292b050607d716502460394596c6339987c0dac5dc8d52c
jobIndexPath=/data/bridge-results/operator-job-index.json
resultPath=null
recoveryReportPath=null
```

## Reports Exported

```text
/data/bridge-results/operator-status-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
/data/bridge-results/preflight-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
/data/bridge-results/recovery-snapshot-b8d97bd0a32097b26e6f1b6d0f555d9a5c3c7ae762180c027bf10f3507de8049.json
/data/bridge-results/operator-job-index.json
```

## Safety Verification

```text
BRIDGE_DAEMON_MODE=paper
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false
BRIDGE_SETTLE_WITHDRAW_EXECUTE=false
transactionsSubmitted=false
proofsGenerated=false
secretsPrinted=false
```

No secret values were printed. The reports expose only non-secret hashes, booleans, paths, statuses, public PDA addresses, and public transaction IDs.

## Commands Run

```bash
cd chains/solana
npm run bridge:operator:status
npm run bridge:preflight:settle-withdraw
npm run bridge:recovery:snapshot
BRIDGE_SETTLE_WITHDRAW_EXECUTE=false npm run bridge:job:settle-withdraw
```

## Remaining Limitations

- The first operator-status command was intentionally stale and recommended `run_preflight`; after refreshing preflight and recovery snapshot, the job wrapper reached `dry_run_ready`.
- The current destination is already withdrawn according to the spent-nullifier PDA, so the safe action is `no_action_already_complete`.
- Operator prereq was not required at startup (`BRIDGE_HOSTED_REQUIRE_OPERATOR_PREREQ=false`), so startup readiness remains `warning_operator_prereq_skipped`.

## Next Recommended PR

PR-012V should add a convenience hosted command that runs status -> preflight -> recovery snapshot -> status -> dry-run job in sequence and emits one final non-secret operator bundle.
