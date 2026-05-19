# PR-012M - Direct Spent Nullifier PDA Derivation

## Summary

PR-012M lets hosted recovery tooling derive the expected Solana `SpentNullifier` PDA directly from the validated destination note-state and live settlement/FIFO context.

The change is read-only. It does not submit bridge accepts, settle, withdraw, generate proofs, modify circuits, or modify programs.

## Why PR-012M Follows PR-012L

PR-012L required a fresh recovery snapshot before execute/resume mode. The remaining gap was that spent-nullifier PDA checks depended on prior result evidence. PR-012M removes that dependency whenever the snapshot can determine the target leaf index.

## Spent-Nullifier PDA Derivation

The Solana program derives spent-nullifier accounts with:

```text
["nullifier", pool_config, nullifier_hash]
```

The hosted helper computes the internal nullifier hash using the same circuit/verifier formula:

```text
Poseidon(Poseidon(destNullifier, destSecret), leafIndex)
```

It returns only:

- derivation status
- target leaf index
- expected spent-nullifier PDA
- existence status from RPC
- already-consumed boolean

It does not export the destination secret, destination nullifier, witness, or raw nullifier hash.

## Secret Redaction Policy

Reports and logs may include the `SpentNullifier` PDA because the account address is public once derivable from public pool configuration and the private note during operator recovery.

Reports must not include:

- `destSecret`
- `destNullifier`
- witness data
- private keys
- signer keys
- RPC URLs with keys
- operator tokens
- wallet files

## Snapshot Fields Added

`npm run bridge:recovery:snapshot` now includes a non-secret `spentNullifier` summary:

- `derived`
- `status`
- `spentNullifierPda`
- `leafIndex`
- `exists`
- `checkedAt`
- `withdrawAlreadyConsumed`
- safe error code when derivation/checking fails

Readiness can now include:

- `blocked_note_state_invalid`
- `blocked_spent_nullifier_unknown`
- `already_withdrawn_spent_nullifier`

## Job Wrapper Behavior

The settle/withdraw job wrapper already requires a fresh recovery snapshot before execute/resume mode. With PR-012M, that snapshot includes the direct spent-PDA check.

If the snapshot reports an existing spent PDA for the expected note, the wrapper honors `no_action_already_complete` and exits without invoking the mutating verifier.

If the snapshot reports `blocked_note_state_invalid` or `blocked_spent_nullifier_unknown`, execute/resume mode is blocked.

## Already-Withdrawn Handling

When the expected spent-nullifier PDA exists, the snapshot classifies the note as already consumed:

```text
readiness=already_withdrawn_spent_nullifier
recommendedAction=no_action_already_complete
```

The wrapper records the snapshot binding and does not submit another withdraw.

## Tests Run

- `cd chains/solana && npm run bridge:test-recovery:snapshot`
- `cd chains/solana && npm run bridge:test-job:settle-withdraw`
- `cd chains/solana && npm run test:rust`
- `cd chains/solana && npm run build:sbf`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`

## Remaining Limitations

- If the target commitment is already settled and no result evidence records the target leaf index, direct spent-PDA derivation blocks as `blocked_spent_nullifier_unknown`.
- The command remains read-only; it does not repair ambiguous state.

## Next Recommended PR

PR-012N should persist the target settlement leaf index in the job index at settlement-submission boundaries so resume snapshots can derive spent-nullifier PDAs even after process crashes before final result export.
