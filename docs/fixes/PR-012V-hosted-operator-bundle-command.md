# PR-012V - Hosted Operator Bundle Command

## Summary

PR-012V adds a hosted convenience command for the read-only Base Sepolia -> Solana Devnet operator readiness sequence:

```bash
cd chains/solana
npm run bridge:operator:bundle
```

The bundle command runs the existing hosted checks in order, forces the final job wrapper into dry-run mode, and writes one non-secret report:

```text
/data/bridge-results/operator-bundle-<destinationHash>.json
```

It does not submit bridge accept, settlement, withdraw, or proof-generation transactions.

## Why PR-012V Follows PR-012U

PR-012U proved the manual sequence on Render:

1. operator status reported stale preflight;
2. preflight refreshed to `ready`;
3. recovery snapshot refreshed and reported `already_withdrawn_spent_nullifier`;
4. the dry-run job wrapper reached `dry_run_ready`;
5. no transactions were submitted.

PR-012V packages that proven sequence into one operator command so hosted checks are repeatable and less error-prone.

## Bundle Command

Package script:

```bash
npm run bridge:operator:bundle
```

Implementation:

```text
chains/solana/scripts/hosted-operator-bundle.ts
```

The command accepts the same hosted environment used by preflight, recovery snapshot, operator status, and the job wrapper:

```text
PR012B_DESTINATION_MESSAGE_HASH or BRIDGE_DESTINATION_MESSAGE_HASH
PR012B_SOURCE_MESSAGE_HASH or BRIDGE_SOURCE_MESSAGE_HASH
BRIDGE_RESULTS_DIR
BRIDGE_NOTE_STATE_BACKUP_DIR
BRIDGE_OPERATOR_JOB_INDEX_PATH
PROGRAM_ID
POOL_CONFIG
IDL_PATH
```

## Command Sequence

The bundle invokes:

1. `npm --silent run bridge:operator:status`
2. `npm --silent run bridge:preflight:settle-withdraw`
3. `npm --silent run bridge:recovery:snapshot`
4. `npm --silent run bridge:operator:status`
5. `BRIDGE_SETTLE_WITHDRAW_EXECUTE=false npm --silent run bridge:job:settle-withdraw`

Child stdout/stderr is not copied into the final report. The bundle parses child JSON summaries and stores only non-secret status fields.

## Safety Gates

The bundle refuses to run the sequence when:

```text
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true
BRIDGE_SETTLE_WITHDRAW_EXECUTE=true
BRIDGE_DAEMON_MODE is set to anything other than paper
```

The dry-run job step is always launched with:

```text
BRIDGE_SETTLE_WITHDRAW_EXECUTE=false
```

If an operator wants to execute settlement or withdraw after review, they must run the explicit job wrapper separately with an approved execute window. The bundle never performs execution.

## Bundle Report Format

The report includes:

```text
destinationMessageHash
sourceMessageHash
initialOperatorReadiness
refreshedPreflight.readiness
refreshedPreflight.sha256
recoverySnapshot.readiness
recoverySnapshot.recommendedAction
recoverySnapshot.sha256
spentPda.derived
spentPda.exists
spentPda.withdrawAlreadyConsumed
leafIndexEvidence.found
leafIndexEvidence.source
leafIndexEvidence.leafIndex
finalOperatorReadiness
dryRunJob.status
dryRunJob.wouldExecute
final.readiness
final.recommendedAction
final.executionAllowed
final.alreadyComplete
transactionsSubmitted=false
proofsGenerated=false
secretsPrinted=false
```

The report excludes raw child output and redacts sensitive child fields before storage.

## Readiness Statuses

The bundle maps the final result to one of:

```text
ready_for_execute
no_action_already_complete
blocked_preflight
blocked_recovery_snapshot
blocked_note_state
blocked_zkeys
blocked_leaf_index
blocked_wallet
operator_review_required
```

Recommended actions include:

```text
run_bootstrap_zkeys
restore_note_state
run_preflight
run_recovery_snapshot
run_leaf_index_evidence
run_job_execute
no_action_already_complete
operator_review_required
```

## Already-Withdrawn Targets

For the current PR-012U target, recovery snapshot reports:

```text
readiness=already_withdrawn_spent_nullifier
recommendedAction=no_action_already_complete
spentPda.exists=true
withdrawAlreadyConsumed=true
```

The bundle maps this to:

```text
final.readiness=no_action_already_complete
final.recommendedAction=no_action_already_complete
final.executionAllowed=false
final.alreadyComplete=true
```

This is a safe no-op state. It is not permission to submit another settlement or withdraw transaction.

## Tests Run

Focused bundle tests:

```bash
cd chains/solana
node --import tsx scripts/hosted-operator-bundle.test.ts
```

Result:

```text
hosted_operator_bundle_tests_passed
```

The `npm run bridge:test-operator:bundle` wrapper hit the local sandbox's `tsx` IPC socket restriction (`EPERM` under `/tmp/tsx-*`). The same test passed through Node's tsx loader path.

## Remaining Limitations

- The bundle is an operator convenience command; it does not replace explicit approval for execute mode.
- The bundle still depends on the underlying hosted commands for live RPC reads.
- Render should run the bundle with fresh destination/source hash environment for each target.

## Next Recommended PR

PR-012W should add a small hosted operator archive/index view for bundle reports so operators can list the latest bundle, preflight, recovery, and job summaries for a destination hash without inspecting persistent disk manually.
