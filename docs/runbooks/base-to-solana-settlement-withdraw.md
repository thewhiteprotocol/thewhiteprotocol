# Base -> Solana Settlement and Withdraw Runbook

This runbook covers the hosted post-accept workflow after a Base Sepolia -> Solana Devnet BridgeMint has already been accepted by the guarded daemon submit command.

It must not be used to submit a new bridge accept. Keep `BRIDGE_DAEMON_MODE=paper` and `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.

## Required Durable Inputs

- Destination note-state backup directory: `/data/white-bridge-note-state`
- Circuit artifact directory: `/data/circuit-artifacts`
- Result directory: `/data/bridge-results`
- Pool config: `DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF`
- Program id: `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`

Required proving artifacts:

- `/data/circuit-artifacts/merkle_batch_update/merkle_batch_update.zkey`
- `/data/circuit-artifacts/withdraw/withdraw.zkey`

Expected SHA256:

- `merkle_batch_update.zkey`: `107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9`
- `withdraw.zkey`: `cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0`

## Preflight

Run preflight before any settlement or withdraw command:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_CIRCUIT_ARTIFACT_DIR=/data/circuit-artifacts \
BRIDGE_NOTE_STATE_BACKUP_DIR=/data/white-bridge-note-state \
PR012G_PREFLIGHT_RESULT_DIR=/data/bridge-results \
IDL_PATH="$repo_root/chains/solana/sdk/src/idl/white_protocol.json" \
PROGRAM_ID=DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD \
POOL_CONFIG=DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF \
PR012B_SOURCE_MESSAGE_HASH=<source_bridge_out_hash> \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
BRIDGE_NOTE_EXPECTED_DESTINATION_COMMITMENT=<destination_commitment> \
BRIDGE_NOTE_EXPECTED_DESTINATION_AMOUNT=<destination_amount> \
npm run bridge:preflight:settle-withdraw
```

The command is read-only. It verifies zkeys, wasm files, durable note state, pending buffer/FIFO position, wallet authority, and writes a non-secret report to `/data/bridge-results`.

## Interpreting Readiness

- `ready`: target commitment is pending at FIFO index `0` or already settled, and wallet/artifact/note checks pass.
- `blocked_artifacts`: zkeys or wasm files are missing or zkey checksums mismatch.
- `blocked_note_state`: durable note state is missing, under `/tmp`, inside git, or fails exact validation.
- `blocked_fifo`: the target commitment is pending but has earlier FIFO commitments ahead of it.
- `blocked_pending`: the target commitment is not pending and not detected as already settled, or required destination accounts are missing.
- `blocked_wallet`: configured wallet does not match the on-chain pool authority or has no SOL.

If `blocked_fifo` is reported, the operator must explicitly decide whether to settle the FIFO prefix. The mutating verification script requires `PR012B_SETTLE_FIFO_PREFIX=true` for that case.

## Mutating Verification

Use the job wrapper after preflight. The default is dry-run/check-only:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
npm run bridge:job:settle-withdraw
```

The wrapper refuses stale, missing, mismatched, or non-ready preflight reports.
It also binds the job to the SHA256 of the preflight report and records a non-secret operator job entry in `/data/bridge-results/operator-job-index.json`.

To pin the reviewed preflight report explicitly, pass its SHA256:

```bash
BRIDGE_EXPECTED_PREFLIGHT_SHA256=<preflight_report_sha256> \
npm run bridge:job:settle-withdraw
```

Inspect the persistent job index without printing secrets:

```bash
npm run bridge:job:index
BRIDGE_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> npm run bridge:job:show
```

The index records the destination hash, source hash, preflight path and hash, zkey hashes, FIFO plan, wallet public key, status, and result report path. It does not contain note secrets, nullifiers, witnesses, private keys, RPC URLs, or operator tokens.

Job phases are persisted in the index:

- `created`
- `preflight_bound`
- `dry_run_ready`
- `executing`
- `settlement_submitted`
- `settlement_confirmed`
- `withdraw_submitted`
- `withdraw_confirmed`
- `duplicate_withdraw_checked`
- `succeeded`
- `failed`
- `blocked`
- `recovery_required`

Execute mode is explicit:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SETTLE_WITHDRAW_EXECUTE=true \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
PR012B_SUBMIT_TX=<guarded_submit_tx> \
npm run bridge:job:settle-withdraw
```

Execute mode also requires a fresh live recovery snapshot report for the same destination hash. Run the snapshot command after preflight and before execute mode. To pin the reviewed snapshot report explicitly, pass its SHA256:

```bash
BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256=<recovery_snapshot_sha256> \
npm run bridge:job:settle-withdraw
```

The wrapper blocks if the snapshot is missing, stale, destination-mismatched, source-mismatched, changed after binding, or reports a blocked readiness such as `blocked_ambiguous_state`, `blocked_note_state_missing`, `blocked_preflight_missing`, `blocked_preflight_stale`, `blocked_pending_not_found`, `tx_failed`, or `tx_unknown`.

The lower-level verifier remains available for manual recovery only after preflight is reviewed:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

NOTE_STATE="/data/white-bridge-note-state/<destination_hash_without_0x>.bridge-note-state.json"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
IDL_PATH="$repo_root/chains/solana/sdk/src/idl/white_protocol.json" \
PROGRAM_ID=DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD \
POOL_CONFIG=DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF \
PR012B_SETTLE_FIFO_PREFIX=<true_only_if_preflight_reported_fifo_prefix> \
BASE_TO_SOLANA_BRIDGE_STATE_PATH="$NOTE_STATE" \
PR012B_SOURCE_MESSAGE_HASH=<source_bridge_out_hash> \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
PR012B_SUBMIT_TX=<guarded_submit_tx> \
npx tsx scripts/verify-daemon-mint-settle-withdraw.ts
```

Do not print the note-state file. Do not commit reports containing private fields. Preflight and verification outputs are designed to be non-secret, but operator-local note-state remains sensitive.

The wrapper writes non-secret execution reports to `/data/bridge-results/settle-withdraw-<destinationHash>.json`.
After a successful execute-mode run, duplicate execution for the same destination hash is blocked by the job index. Resume mode is for partial/interrupted jobs, not re-running a completed withdrawal.

## Resume And Recovery

Use resume mode only for a partial or interrupted job:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SETTLE_WITHDRAW_RESUME=true \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
npm run bridge:job:settle-withdraw
```

This is still dry-run/check-only unless `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` is also set. The wrapper writes a non-secret recovery report:

```text
/data/bridge-results/recovery-<destinationHash>.json
```

Resume mode checks the existing job index entry, preflight hash binding, pending/FIFO state, settlement/withdraw tx phase, and spent-nullifier state before deciding whether a missing phase can continue. Ambiguous state blocks. Examples include an unknown settlement tx status, a withdraw tx without a spent-nullifier signal, a preflight hash mismatch, or consumed/spent state that conflicts with the requested destination hash.

## Live Recovery Snapshot

Before any resume execution, run the read-only live snapshot command:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
PROGRAM_ID=DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD \
POOL_CONFIG=DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF \
BASE_TO_SOLANA_BRIDGE_STATE_PATH=/data/white-bridge-note-state/<destination_hash_without_0x>.bridge-note-state.json \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
PR012B_SOURCE_MESSAGE_HASH=<source_bridge_out_hash> \
PR012B_SUBMIT_TX=<guarded_submit_tx_if_available> \
npm run bridge:recovery:snapshot
```

The command does not submit transactions, settle, withdraw, or generate proofs. It checks submit tx status when provided, destination PDAs, pending/FIFO state, note-state readiness, preflight report linkage, and the operator job index. It writes:

```text
/data/bridge-results/recovery-snapshot-<destinationHash>.json
```

The snapshot derives the expected spent-nullifier PDA directly from destination note-state when the target leaf index is known. It reports only non-secret metadata: `spentNullifierPda`, `leafIndex`, `exists`, `checkedAt`, and `withdrawAlreadyConsumed`. It never prints `destSecret`, `destNullifier`, witness data, or the raw nullifier hash.

Readiness values include `ready_for_resume`, `blocked_note_state_missing`, `blocked_note_state_invalid`, `blocked_spent_nullifier_unknown`, `blocked_preflight_missing`, `blocked_preflight_stale`, `blocked_destination_hash_mismatch`, `blocked_pending_not_found`, `blocked_ambiguous_state`, `already_settled_pending_missing`, `already_withdrawn_spent_nullifier`, `tx_failed`, and `tx_unknown`.

If the expected spent-nullifier PDA exists, the snapshot reports `already_withdrawn_spent_nullifier` with `recommendedAction=no_action_already_complete`; the job wrapper must not submit another withdraw.

## Required Execute Order

For every hosted settle/withdraw execution window, use this order:

1. `npm run bridge:preflight:settle-withdraw`
2. `npm run bridge:recovery:snapshot`
3. `npm run bridge:job:settle-withdraw` without execute flags
4. `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true npm run bridge:job:settle-withdraw`

For resume execution, add `BRIDGE_SETTLE_WITHDRAW_RESUME=true` only after the fresh recovery snapshot recommends `resume_settlement`, `resume_withdraw`, or `settle_fifo_prefix`.

The wrapper enforces recovery snapshot recommendations:

- `resume_settlement`: resume settlement handoff is permitted.
- `settle_fifo_prefix`: FIFO-prefix settlement handoff is permitted only after operator review.
- `resume_withdraw`: settlement is not rerun; the wrapper passes `PR012B_RESUME_PHASE=settlement_confirmed`.
- `no_action_already_complete`: the wrapper exits successfully without invoking the mutating verifier.
- `operator_review_required`, `run_preflight`, or `restore_note_state`: execution is blocked.

The operator job index records the recovery snapshot path, SHA256, created timestamp, readiness, and recommended action alongside the preflight binding.

## Hosted Dry-Run Evidence

For already-settled targets, the recovery snapshot must not guess a leaf index. If the target is already settled and no trusted result/job evidence contains the target `nextLeafIndexBefore`, the snapshot reports:

```text
readiness=blocked_spent_nullifier_unknown
recommendedAction=operator_review_required
spentNullifier.error=leaf_index_missing
```

In that state, the dry-run job wrapper must block and record both report hashes:

```text
status=blocked
readiness=blocked_recovery_snapshot_readiness
execute=false
wouldExecute=false
transactionsSubmittedByWrapper=false
```

This is the expected safe result. Do not set `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` until the missing evidence is restored and a fresh recovery snapshot recommends a permitted action.
