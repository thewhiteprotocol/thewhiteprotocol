# PR-011R — Solana Destination Simulation And Final Approval Gate

## Summary

PR-011R adds the approval and simulation gates needed before any future Solana destination submission work.

The relayer can now require an explicitly approved destination BridgeMint hash, re-run read-only idempotency checks immediately before simulation, and simulate the assembled `accept_bridge_v1_mint` transaction with `sigVerify=false` when a safe Solana RPC connection is supplied.

No Solana transaction was submitted.

## What PR-011Q Completed

PR-011Q added unsigned dry-run assembly for the Solana `accept_bridge_v1_mint` transaction:

- destination BridgeMint hash usage
- source BridgeOut hash preservation as audit metadata
- signer set version `2`
- deployed Solana Devnet accounts
- compute budget instructions
- account meta validation
- nonzero unsigned serialization
- `transactionAssemblyImplemented=true`
- `liveSubmissionImplemented=false`

## Approval Gate Design

The approval gate uses `BRIDGE_APPROVED_MESSAGE_HASHES`.

Allowed formats:

- `0x...`
- `base-sepolia->solana-devnet|0x...`
- `base-sepolia->solana-devnet|0x...|<expiresAtUnixSeconds>`

Rules:

- the approved hash must be the destination BridgeMint hash
- approving only the source BridgeOut hash is rejected
- missing approval returns `blocked_approval_required`
- wrong hash returns `blocked_approval_hash_mismatch`
- expired approval returns `blocked_approval_expired`

## Pre-Submit Idempotency Checks

Before simulation, the Solana adapter can re-run read-only checks for:

- program executable
- BridgeV1Config exists
- signer set exists
- route config exists
- asset config exists
- pending buffer exists
- pool config exists
- Merkle tree exists
- asset vault exists
- consumed message PDA absent
- frozen message PDA absent
- commitment index PDA absent

Any failed or unknown check blocks simulation.

## Simulation Design

`simulateSolanaAcceptBridgeMintTransaction`:

- refreshes the transaction blockhash
- calls `simulateTransaction`
- passes `sigVerify=false`
- never calls send APIs
- returns sanitized logs
- records slot, blockhash, units consumed, and error summary when available

`simulateSolanaAcceptBridgeMintTransactionWithGates` combines:

- destination hash approval
- read-only idempotency checks
- simulation

## Simulation Result

Live hosted simulation was not attempted in PR-011R.

Reason: this PR adds the safe implementation and mocked coverage only. Running against hosted Solana RPC should be done after the operator sets `BRIDGE_APPROVED_MESSAGE_HASHES` for the exact PR-011N destination BridgeMint hash and confirms the target message remains unconsumed.

## Preview And Status Fields

Solana submit previews now expose:

- `approvalStatus`
- `approvedMessageHash`
- `readyForLiveSubmit`
- `preSubmitChecksAt`
- `idempotencyStatus`
- `simulationStatus`
- `simulationResult`
- `liveSubmissionImplemented=false`

In daemon paper mode, `readyForLiveSubmit` remains `false` because live submission is still not implemented and no RPC simulation is run by default.

## Tests Added

Added tests for:

- missing approval blocks readiness
- source hash approval is rejected
- destination hash approval passes
- expired approval is rejected
- consumed/frozen/commitment-index idempotency blockers
- mocked simulation success with `sigVerify=false`
- sanitized simulation failure logs
- no send calls in simulation mode
- gated simulation re-runs read-only checks
- daemon preview exposes approval and live-readiness fields

## Commands Run

- `cd relayer && npm run test` — passed
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed
- `cd relayer && npm run watcher:smoke` — passed
- `cd relayer && npm run watcher:report` — passed

## Why No Transaction Was Sent

- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- daemon paper mode remains non-submitting
- simulation uses `simulateTransaction`, not send APIs
- `liveSubmissionImplemented=false`
- no destination adapter send path was added

## Remaining Limitations

- Live hosted simulation was not run in this PR.
- The Solana transaction is still unsigned by a real fee payer in daemon paper mode.
- There is still no live submit path.
- `readyForLiveSubmit` is exposed for gate evaluation, but live submission remains disabled.
- Mainnet remains unsupported.
- Not production-ready.

## Next Recommended PR

PR-011S — hosted Solana simulation for the approved PR-011N message:

- set `BRIDGE_APPROVED_MESSAGE_HASHES` to the exact destination BridgeMint hash
- run read-only idempotency checks against Solana Devnet
- simulate the assembled transaction with hosted RPC
- keep live submit disabled
- record simulation logs and compute units
