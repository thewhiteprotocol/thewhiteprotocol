# PR-012H - Hosted Settle/Withdraw Job Wrapper

## Summary

PR-012H adds a hosted operator job wrapper for the Base Sepolia -> Solana Devnet post-accept settlement/withdraw workflow. The wrapper refuses to run the mutating verifier unless a fresh PR-012G preflight report exists and all required gates pass.

The default mode is dry-run/check-only. It does not submit settlement or withdraw transactions unless `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true` is explicitly set.

No bridge accept, settlement, or withdraw transaction was submitted by this PR.

## Why PR-012H Follows PR-012G

PR-012G added hosted preflight automation for:

- zkey checksum verification
- durable note-state validation
- pending/FIFO planning
- wallet authority checks
- non-secret report export

PR-012H makes that preflight report a hard prerequisite for the operator job that can run settlement/withdraw.

## Preflight Report Requirement

Added command:

- `cd chains/solana && npm run bridge:job:settle-withdraw`

The wrapper locates the preflight report from:

- `BRIDGE_PREFLIGHT_REPORT_PATH`, or
- `/data/bridge-results/preflight-<destinationHash>.json`

The destination hash must be provided with:

- `PR012B_DESTINATION_MESSAGE_HASH`, or
- `BRIDGE_DESTINATION_MESSAGE_HASH`

The report destination hash must match the requested destination hash.

## Freshness Requirement

The wrapper requires the report to be fresh:

- Default max age: `900` seconds
- Override: `BRIDGE_PREFLIGHT_MAX_AGE_SECONDS`

Stale or unparsable `generatedAt` values block execution.

## Dry-Run Default

`BRIDGE_SETTLE_WITHDRAW_EXECUTE=false` by default.

In dry-run mode:

- no settlement transaction is submitted
- no withdraw transaction is submitted
- the wrapper prints a non-secret readiness summary
- exit is `0` only if all gates are ready

## Execute Flag

Execution requires:

- `BRIDGE_SETTLE_WITHDRAW_EXECUTE=true`

When enabled, the wrapper runs:

- `npx tsx scripts/verify-daemon-mint-settle-withdraw.ts`

The wrapper passes through the exact source/destination hashes and note-state path from the validated preflight report.

## Required Env Vars

Required for job gating:

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `PR012B_DESTINATION_MESSAGE_HASH` or `BRIDGE_DESTINATION_MESSAGE_HASH`

Execution mode also relies on the existing verification script inputs, including:

- `ANCHOR_WALLET` or configured authority key material in the local environment
- `IDL_PATH`
- `PROGRAM_ID`
- `POOL_CONFIG`
- `PR012B_SUBMIT_TX`

Secret values are not printed.

## Safety Blockers

The wrapper blocks on:

- missing preflight report
- stale preflight report
- destination hash mismatch
- preflight readiness not `ready`
- zkey hash mismatch or missing artifact
- invalid durable note state
- note-state path under `/tmp`
- target not pending or not safely planned
- FIFO prefix still required
- wallet authority mismatch
- live submit enabled
- missing required env

## Result Report Format

In execute mode, the wrapper writes a non-secret report to:

- `/data/bridge-results/settle-withdraw-<destinationHash>.json`

The report includes:

- destination hash
- source hash
- settlement tx
- withdraw tx
- duplicate withdraw result
- old/new Merkle root
- nextLeafIndex before/after
- pending counts
- recipient/vault balance fields
- `transactionsSubmittedByWrapper=false`
- `secretsPrinted=false`

The wrapper sanitizes the verifier output and does not include note secrets, nullifiers, witness values, private keys, RPC secrets, or wallet files.

## Render Command Examples

Dry-run/check-only:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/chains/solana"

BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
PR012B_DESTINATION_MESSAGE_HASH=<destination_bridge_mint_hash> \
npm run bridge:job:settle-withdraw
```

Execute mode, only after operator approval:

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

## Tests Run

- `cd chains/solana && npm run bridge:test-preflight:settle-withdraw`: passed
- `cd chains/solana && npm run bridge:test-job:settle-withdraw`: passed
- `cd chains/solana && npm run test:rust`: passed, `115` tests
- `cd chains/solana && npm run build:sbf`: passed
- `cd relayer && npm run test`: passed, `25` suites / `354` tests
- `cd relayer && npm run typecheck`: passed
- `cd relayer && npm run build`: passed
- `cd relayer && npm run watcher:smoke`: passed
- `cd relayer && npm run watcher:report`: passed, `openFindings=0`

## Remaining Limitations

- Render app image still lacks Rust/SBF tooling; Rust and SBF validation run in Codespace.
- The wrapper does not bypass FIFO requirements. If preflight reports `blocked_fifo`, the operator must settle or approve FIFO handling separately.
- Execute mode still delegates proof generation and mutation to `verify-daemon-mint-settle-withdraw.ts`.

## Next Recommended PR

PR-012I should add a persistent hosted operator job log/index and require the mutating verifier to reference a preflight report hash, so job execution can be audited without relying on shell transcript history.
