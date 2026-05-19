# PR-012K - Live Recovery Snapshot

## Summary

PR-012K adds a read-only live recovery snapshot command for hosted Base -> Solana settlement/withdraw recovery. The command checks Solana tx status, destination PDAs, pending/FIFO state, note-state readiness, preflight linkage, and operator job-index state before any resume execution.

It does not submit transactions, settle, withdraw, or generate proofs.

## Why PR-012K Follows PR-012J

PR-012J made interrupted jobs resumable but intentionally conservative. PR-012K gives operators a direct read-only command to inspect live Solana state before they decide whether resume execution is safe.

## Snapshot Command

```bash
cd chains/solana
npm run bridge:recovery:snapshot
```

## Required Inputs

- `PR012B_DESTINATION_MESSAGE_HASH` or `BRIDGE_DESTINATION_MESSAGE_HASH`
- `PROGRAM_ID`
- `POOL_CONFIG`
- `BASE_TO_SOLANA_BRIDGE_STATE_PATH`

Optional:

- `PR012B_SOURCE_MESSAGE_HASH` or `BRIDGE_SOURCE_MESSAGE_HASH`
- `PR012B_SUBMIT_TX`
- `BRIDGE_PREFLIGHT_REPORT_PATH`
- `BRIDGE_OPERATOR_JOB_INDEX_PATH`
- `BRIDGE_RECOVERY_SNAPSHOT_PATH`

## PDA Checks

The command derives and checks:

- consumed bridge message PDA
- frozen bridge message PDA
- commitment index PDA when note-state provides the destination commitment
- pending deposits buffer
- pool config
- Merkle tree
- asset vault
- spent nullifier PDA when a prior result report identifies it

Only account existence, owner, and expected-owner match are reported. Raw account bytes are not printed.

## Pending And FIFO Interpretation

When note-state is available, the command locates the target destination commitment in the pending buffer and reports:

- target pending index
- pending count
- FIFO prefix requirement
- entries before target
- already-settled signal via commitment index
- current Merkle root
- current next leaf index

If note-state is missing, commitment lookup is skipped and readiness is blocked for withdraw/resume.

## Note-State Checks

The command validates a non-secret summary:

- source hash if provided
- destination hash
- destination commitment
- amount/asset when available
- `hasDestSecret`
- `hasDestNullifier`

Secret values are never printed.

## Preflight And Job Index Linking

If a preflight report exists, the snapshot records:

- path
- SHA256
- readiness
- age
- destination hash match

If the operator job index exists, the snapshot records:

- latest phase
- latest job id
- settlement tx
- withdraw tx
- result report path
- whether duplicate execution would block

## Readiness Statuses

- `ready_for_resume`
- `blocked_note_state_missing`
- `blocked_preflight_missing`
- `blocked_preflight_stale`
- `blocked_destination_hash_mismatch`
- `blocked_pending_not_found`
- `blocked_ambiguous_state`
- `already_settled_pending_missing`
- `already_withdrawn_spent_nullifier`
- `tx_failed`
- `tx_unknown`

## Recommended Actions

- `run_preflight`
- `restore_note_state`
- `settle_fifo_prefix`
- `resume_settlement`
- `resume_withdraw`
- `no_action_already_complete`
- `operator_review_required`

## Report Format

Default path:

```text
/data/bridge-results/recovery-snapshot-<destinationHash>.json
```

The report includes tx status, PDA checks, pending/FIFO state, note-state summary, preflight SHA256, job-index phase, readiness, and recommended action. It contains no note secrets, nullifiers, witness data, private keys, signer keys, RPC URLs, operator tokens, env values, or wallet files.

## Tests Run

- `cd chains/solana && npm run bridge:test-recovery:snapshot`
- `cd chains/solana && npm run bridge:test-job:settle-withdraw`

Full validation should also run:

- `cd chains/solana && npm run test:rust`
- `cd chains/solana && npm run build:sbf`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

## Remaining Limitations

- Render still needs durable zkeys, durable note-state, and fresh preflight/job index artifacts before recovery can be meaningful.
- The command is read-only; it does not repair ambiguous state.
- Spent-nullifier PDA checks require prior result evidence or a future direct nullifier derivation helper.

## Next Recommended PR

PR-012L should wire the live recovery snapshot into the resume wrapper as a required fresh input before `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` resume execution.
