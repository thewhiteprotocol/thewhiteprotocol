# PR-013B - Solana to Base Operator Approval Readiness

## Summary

PR-013B adds a guarded, read-only approval check for the fresh Solana Devnet -> Base Sepolia paper message from PR-013A. The check reviews the persisted paper daemon state, verifies that the Base preview targets `BridgeInbox.acceptBridgeMint`, performs Base read-only idempotency/config checks, and runs a `callStatic`-style simulation without sending a transaction.

The exact message is **not ready for operator approval**. Base read-only checks pass, but the Base simulation reverts with `InvalidSigner`, which means the paper signatures are not acceptable to the deployed Base signer set for live destination submit.

## PR-013A Evidence Reviewed

- Solana deposit: `1Uyz8VcRudzT9ZC2UCdpYq3uGGXH8K4PAyCgwJqpZ8groje4LXQEHnEWUJKU8kzksXohHfFZLAdeomAVqMFKDzw`
- Solana settlement: `3qqpsJ1ja75RgxykdQTVvwT7WtwtdFr2AMiSQ1F8rvRMzTdkHw39i6FpPiatrFhKMnfzaWJZgdmC4EM1kocDAKVc`
- Solana `bridge_out_v1_with_proof`: `1JFuyazkGGMeTAo2Qg65XxfMCtvSwUHxad3p6kbKnsN5niecpKe3mhBfFUh9x5v89V26oJHAvrcMbra2cx4AbA2`
- Source slot: `463688066`
- Source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- Source nullifier spent: `true`
- Source value locked: `true`
- Amount normalization: `1000000 -> 1000000000000000`
- Paper replay status: `paper_ready_to_submit`
- Base destination tx submitted: `false`

## Paper State Review

Reviewed paper state path:

`/tmp/pr013a-solana-to-base-paper-state`

The persisted message preserves the source hash separately from the destination BridgeMint hash. The approval checker requires the destination BridgeMint hash and rejects using the source hash as the approval target.

## Base Submit Preview

- Destination chain: `base-sepolia`
- Method: `BridgeInbox.acceptBridgeMint`
- Target BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Source hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- Signature count: `2`
- `dryRun`: `true`
- `wouldSubmit`: `true`
- `submitTxHash`: `null`

## Base Read-Only Checks

The guarded approval command confirmed:

- BridgeInbox contract exists: `true`
- Current signer set version: `1`
- Signer set version matches preview: `true`
- Global pause: `false`
- Solana -> Base route enabled: `true`
- Route paused: `false`
- Asset supported: `true`
- Local asset set: `true`
- Message consumed: `false`
- Message frozen: `false`
- Max message amount: `10000000000000000`
- Amount within cap: `true`
- No open critical watcher finding recorded by this approval check: `true`

## Simulation Result

Simulation was attempted with `BRIDGE_DAEMON_MODE=paper` and `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.

Result: blocked.

Decoded revert: `InvalidSigner`.

This is a fail-closed result. The current paper signatures cannot be approved for live Base destination submit. No send API was called and no destination transaction was submitted.

## Approval Checklist

For this exact destination hash:

- Source tx verified: yes
- Source instruction is `bridge_out_v1_with_proof`: yes
- Unsafe `init_bridge_v1_out` path used: no
- Source nullifier spent: yes
- Source value locked: yes
- Finality satisfied: yes
- Policy accepted: yes
- Watcher critical finding: none recorded for this check
- Amount normalization exact: yes
- Destination BridgeMint hash reviewed: yes
- Source hash preserved separately: yes
- Base route enabled/read-only checks pass: yes
- Simulation/callStatic passes: no, blocked by `InvalidSigner`
- Live submit disabled: yes
- Approval status: not approved

Stop condition: do not submit this message until a new paper replay or approval package uses signatures that validate against the deployed Base signer set.

## Proof No Transaction Was Submitted

- Approval command uses read-only contract calls plus simulation/estimation only.
- `destinationTxSubmitted=false`
- `submitTxHash=null`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`

## Tests Run

- `cd relayer && npm run test -- solana-to-base-approval`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- The PR-013A paper message was signed by the paper replay signer context, but Base simulation rejects the signatures as `InvalidSigner`.
- A live submit approval package still needs destination-valid operator signatures for the deployed Base BridgeInbox signer set.
- No Base destination submit was performed.

## Next Recommended PR

PR-013C should regenerate or re-sign the Solana -> Base paper-ready message with the deployed Base signer set, rerun the guarded approval command, and require a passing Base simulation before any explicit live destination submit window is considered.
