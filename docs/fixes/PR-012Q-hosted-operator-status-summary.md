# PR-012Q - Hosted Operator Status Summary

## Summary

PR-012Q adds a single read-only hosted operator status command for Base Sepolia -> Solana Devnet settlement/withdraw operations:

```bash
cd chains/solana
npm run bridge:operator:status
```

The command reads persistent hosted artifacts and reports, then emits one non-secret readiness summary and recommended action. It does not submit transactions, settle, withdraw, or generate proofs.

## Why PR-012Q Follows PR-012P

PR-012P added explicit zkey bootstrap and operator prerequisite checks. After bootstrap, preflight, recovery snapshot, leaf-index evidence, and dry-run job reports exist across several files under `/data/bridge-results`.

PR-012Q gives operators one status command that summarizes those files without opening each report manually.

## Operator Status Command

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
BRIDGE_RESULTS_DIR=/data/bridge-results \
BRIDGE_OPERATOR_JOB_INDEX_PATH=/data/bridge-results/operator-job-index.json \
PROGRAM_ID=DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD \
POOL_CONFIG=DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF \
PR012B_SOURCE_MESSAGE_HASH=<source_bridge_out_hash> \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
npm run bridge:operator:status
```

## Inputs

- `PR012B_DESTINATION_MESSAGE_HASH` or `BRIDGE_DESTINATION_MESSAGE_HASH`
- `PR012B_SOURCE_MESSAGE_HASH` or `BRIDGE_SOURCE_MESSAGE_HASH` optional
- `BRIDGE_RESULTS_DIR`, default `/data/bridge-results`
- `BRIDGE_NOTE_STATE_BACKUP_DIR`, default `/data/white-bridge-note-state`
- `BRIDGE_CIRCUIT_ARTIFACT_DIR`, default `/data/circuit-artifacts`
- `BRIDGE_OPERATOR_JOB_INDEX_PATH`, default `/data/bridge-results/operator-job-index.json`

## Output Fields

The JSON summary includes:

- `destinationMessageHash`
- `sourceMessageHash`
- `safeMode`
- `zkeys`
- `noteState`
- `preflight`
- `recovery`
- `leafIndex`
- `job`
- `resultReport`
- `final.readiness`
- `final.recommendedAction`

No note secret, destination nullifier, witness, private key, signer key, RPC secret, operator token, env dump, wallet file, or raw nullifier hash is printed.

## Readiness Statuses

Top-level readiness values:

```text
ready_for_dry_run_job
ready_for_execute
blocked_zkeys
blocked_note_state
blocked_preflight_missing
blocked_preflight_stale
blocked_recovery_missing
blocked_recovery_stale
blocked_leaf_index_missing
blocked_job_incomplete
already_complete
operator_review_required
```

## Recommended Actions

```text
run_bootstrap_zkeys
restore_note_state
run_preflight
run_recovery_snapshot
run_leaf_index_evidence
run_job_dry_run
run_job_execute
no_action_already_complete
operator_review_required
```

## Render Usage

After every Render deploy:

```bash
cd "$(git rev-parse --show-toplevel)/chains/solana"
npm run bridge:bootstrap:zkeys
npm run bridge:operator:prereq
npm run bridge:operator:status
```

During an operator window, run status after each stage:

```text
bootstrap -> status -> preflight -> status -> recovery snapshot -> status -> dry-run job -> status
```

For already-withdrawn targets, expected status is:

```text
final.readiness=already_complete
final.recommendedAction=no_action_already_complete
```

## Tests Run

Codespace validation:

```text
cd chains/solana && npm run bridge:test-operator:status
cd chains/solana && npm run bridge:test-job:settle-withdraw
cd chains/solana && npm run test:rust
cd chains/solana && npm run build:sbf
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npm run watcher:smoke
cd relayer && npm run watcher:report
```

## Remaining Limitations

- The command summarizes existing files; it does not perform live Solana recovery checks itself. Run `bridge:recovery:snapshot` for live PDA/RPC state.
- Bootstrap remains explicit and is not wired into Render startup automatically.
- The status command writes a non-secret summary report under `/data/bridge-results`, which remains an operator artifact and must not be committed.

## Next Recommended PR

PR-012R should add automatic hosted startup invocation for the zkey bootstrap command or a Render start-command wrapper that fails closed when persistent zkeys are missing or mismatched.
