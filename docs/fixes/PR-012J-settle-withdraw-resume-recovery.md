# PR-012J - Settle/Withdraw Resume And Recovery

## Summary

PR-012J adds audited resume/recovery behavior to the hosted Base -> Solana settlement/withdraw job wrapper. The wrapper now persists explicit phases, writes a non-secret recovery report, blocks ambiguous partial state, and requires `BRIDGE_SETTLE_WITHDRAW_RESUME=true` before continuing an interrupted job.

No transactions are submitted by default.

## Why PR-012J Follows PR-012I

PR-012I made jobs auditable and bound each job to the exact preflight report SHA256. PR-012J builds on that index so an interrupted job can be resumed without blindly repeating settlement or withdraw steps.

## Job Phases

The persistent job index supports:

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

Phase changes are written to the operator job index before or after mutation boundaries.

## Resume Mode

Resume mode is explicit:

```bash
BRIDGE_SETTLE_WITHDRAW_RESUME=true npm run bridge:job:settle-withdraw
```

This remains dry-run/check-only unless execute mode is also explicit:

```bash
BRIDGE_SETTLE_WITHDRAW_RESUME=true \
BRIDGE_SETTLE_WITHDRAW_EXECUTE=true \
npm run bridge:job:settle-withdraw
```

Normal execute mode blocks existing partial jobs unless resume mode is set.

## On-Chain Recovery Checks

The wrapper records a recovery snapshot before continuing a partial job. The snapshot covers:

- consumed-message PDA signal
- commitment pending/already-settled signal
- pending index/count and FIFO requirement
- commitment-index signal
- spent-nullifier signal
- known settlement and withdraw tx status when available
- inferred phase
- ambiguity/errors

The default hosted path derives these checks from the latest preflight/job state, and tests inject mocked recovery snapshots so no live RPC is required for unit coverage.

## Ambiguous State Blockers

Resume blocks if:

- the preflight report hash does not match the bound hash;
- destination hash does not match;
- note-state, zkey, wallet, or FIFO gates fail;
- a settlement tx exists but confirmation cannot be established;
- a withdraw tx exists but spent-nullifier state cannot be established;
- pending/FIFO state conflicts with the job phase;
- recovery snapshot reports ambiguity.

## Recovery Report Format

Default path:

```text
/data/bridge-results/recovery-<destinationHash>.json
```

The report is non-secret and includes:

- destination hash
- job id
- previous phase
- inferred on-chain phase
- action taken
- settlement/withdraw tx hashes checked
- phase after recovery
- recovery snapshot booleans/statuses

It does not contain note secrets, nullifiers, witnesses, private keys, signer keys, RPC URLs, operator tokens, or wallet files.

## Operator Commands

Dry-run recovery check:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SETTLE_WITHDRAW_RESUME=true \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
npm run bridge:job:settle-withdraw
```

Execute after reviewed recovery report:

```bash
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SETTLE_WITHDRAW_RESUME=true \
BRIDGE_SETTLE_WITHDRAW_EXECUTE=true \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
npm run bridge:job:settle-withdraw
```

## Tests Run

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

- Render still needs durable zkeys, durable note-state, and a fresh preflight before hosted jobs can pass.
- Render does not include Rust/SBF tooling; Rust and SBF validation run in Codespace.
- Recovery is conservative. Ambiguous state requires operator investigation instead of automatic retry.

## Next Recommended PR

PR-012K should add a read-only live recovery snapshot command that directly queries Solana Devnet tx status, commitment-index accounts, and spent-nullifier PDAs for operator review before resume execution.
