# PR-012L - Require Recovery Snapshot Before Resume

## Summary

PR-012L hardens hosted Base -> Solana settlement/withdraw execution by requiring a fresh PR-012K live recovery snapshot report before any execute or resume mode can mutate state.

Default behavior remains dry-run/check-only. No bridge accept, settlement, withdraw, or proof generation is performed by default.

## Why PR-012L Follows PR-012K

PR-012K added a read-only command that checks live Solana tx status, PDAs, pending/FIFO state, note-state readiness, preflight linkage, and job-index state. PR-012L makes that live snapshot an execution gate, so operators cannot resume from stale or ambiguous local assumptions.

## Required Order Of Operations

1. Run `npm run bridge:preflight:settle-withdraw`.
2. Run `npm run bridge:recovery:snapshot`.
3. Run `npm run bridge:job:settle-withdraw` in dry-run mode.
4. Execute only with `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` after both reports are reviewed.
5. Resume only with both `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` and `BRIDGE_SETTLE_WITHDRAW_RESUME=true`.

## Preflight Report Gate

The existing PR-012H/PR-012I gate still requires a fresh preflight report for the exact destination BridgeMint hash. The wrapper binds the job to the preflight report SHA256 and blocks if the report is stale, missing, mismatched, changed after binding, or not ready.

## Recovery Snapshot Gate

Execute mode now also requires:

- recovery snapshot report exists
- destination hash matches the requested destination hash
- source hash matches when provided
- report is fresh
- readiness is not blocked
- recommended action is compatible with the requested mode
- report shows `transactionsSubmitted=false`, `proofsGenerated=false`, and `secretsPrinted=false`

Default path:

```text
/data/bridge-results/recovery-snapshot-<destinationHash>.json
```

Override:

```text
BRIDGE_RECOVERY_SNAPSHOT_PATH=/path/to/recovery-snapshot.json
```

## Recovery Snapshot Freshness

Default max age is 900 seconds.

Override:

```text
BRIDGE_RECOVERY_SNAPSHOT_MAX_AGE_SECONDS=900
```

## Recovery Snapshot SHA256 Binding

The wrapper computes the snapshot report SHA256 and records it in the operator job index. Operators can pin the reviewed snapshot with:

```text
BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256=<snapshot_sha256>
```

A mismatch blocks execution. If the snapshot report changes after binding and before the verifier handoff, execution is blocked.

## Resume Behavior By Recommended Action

- `resume_settlement`: settlement/resume handoff may proceed when readiness is `ready_for_resume`.
- `settle_fifo_prefix`: execution may proceed only after the operator accepts FIFO-prefix settlement policy.
- `resume_withdraw`: resume handoff skips the settlement phase and sets the resume phase to `settlement_confirmed`.
- `no_action_already_complete`: wrapper exits successfully without invoking the mutating verifier.
- `operator_review_required`, `run_preflight`, and `restore_note_state`: execution is blocked.

Blocked readiness values such as `blocked_ambiguous_state`, `blocked_note_state_missing`, `blocked_preflight_missing`, `blocked_preflight_stale`, `blocked_pending_not_found`, `tx_failed`, and `tx_unknown` are stop conditions.

## No-Op Completed State Handling

When the snapshot reports `already_withdrawn_spent_nullifier` with `no_action_already_complete`, the wrapper records the snapshot binding and exits without submitting transactions. This prevents duplicate withdraw attempts for already-consumed notes.

## Operator Commands

```bash
cd chains/solana
npm run bridge:preflight:settle-withdraw
npm run bridge:recovery:snapshot
npm run bridge:job:settle-withdraw
```

Execute mode remains explicit:

```bash
BRIDGE_SETTLE_WITHDRAW_EXECUTE=true \
BRIDGE_EXPECTED_PREFLIGHT_SHA256=<preflight_sha256> \
BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256=<snapshot_sha256> \
npm run bridge:job:settle-withdraw
```

Resume execute mode:

```bash
BRIDGE_SETTLE_WITHDRAW_EXECUTE=true \
BRIDGE_SETTLE_WITHDRAW_RESUME=true \
BRIDGE_EXPECTED_PREFLIGHT_SHA256=<preflight_sha256> \
BRIDGE_EXPECTED_RECOVERY_SNAPSHOT_SHA256=<snapshot_sha256> \
npm run bridge:job:settle-withdraw
```

## Tests Run

- `cd chains/solana && npm run bridge:test-job:settle-withdraw`
- `cd chains/solana && npm run bridge:test-recovery:snapshot`
- `cd chains/solana && npm run test:rust`
- `cd chains/solana && npm run build:sbf`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

## Remaining Limitations

- Render still needs durable zkeys, durable note-state, a fresh preflight report, and a fresh recovery snapshot before hosted execution can pass.
- Spent-nullifier PDA checks still rely on prior result evidence until direct nullifier derivation is added.
- The underlying verifier remains the mutating execution engine; the wrapper enforces the gate and resume-phase handoff before invoking it.

## Next Recommended PR

PR-012M should add direct spent-nullifier PDA derivation from validated note-state so recovery snapshots no longer depend on prior result evidence for already-withdrawn detection.
