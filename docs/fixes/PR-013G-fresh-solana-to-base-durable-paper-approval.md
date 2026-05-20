# PR-013G - Fresh Solana to Base Durable Paper Approval

## Summary

PR-013G prepares the fresh Solana Devnet -> Base Sepolia source-event flow so the source-only command can write the non-secret fixture directly to durable `/data` storage using the generated source message hash.

The fresh source event was **not generated in this local workspace** because `/data` is not mounted and the required hosted RPC/signer/wallet environment names are not present. No Base destination transaction was submitted.

## Why PR-013G Follows PR-013F

PR-013F proved the PR-013A fixture can be reconstructed from the finalized Solana source transaction, but the message now replays as `expired_deadline`.

Therefore a new approved low-value Solana Devnet -> Base Sepolia source event is required before approval and simulation can succeed again.

## Fresh Source Event Evidence

Status: pending Render execution.

Render command shape:

```bash
cd chains/solana
PR012Z_SOURCE_ONLY=true \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SOLANA_SOURCE_FIXTURE_DIR=/data/bridge-results \
npm run bridge:solana-to-base:source-fixture
```

The command writes the fixture as:

```text
/data/bridge-results/solana-to-base-source-fixture-<sourceMessageHash>.json
```

Expected source-only output:

- Solana deposit tx
- Solana settlement tx
- Solana `bridge_out_v1_with_proof` tx
- source slot
- source message hash
- destination BridgeMint hash
- source amount
- normalized destination amount
- deadline
- source nullifier spent
- source value locked
- durable fixture path
- `destinationTxSubmitted=false`

## Durable Fixture Evidence

Status: pending Render execution.

The fixture must contain only non-secret fields:

- source and destination route
- source tx
- slot
- event kind `bridge_out_v1_with_proof`
- `sourceBoundProofMarker=bridge_out_v1_with_proof`
- encoded or decoded `BridgeMessageV1`
- source message hash
- destination BridgeMint hash
- amount fields
- asset IDs
- deadline

It must not contain note secrets, witnesses, private keys, wallet files, RPC URLs, or operator tokens.

## Paper Replay Evidence

Status: pending Render execution.

Render command shape:

```bash
cd relayer
BRIDGE_DAEMON_REPLAY_ROUTE=solana-devnet:base-sepolia \
BRIDGE_SOLANA_SOURCE_EVENTS_PATH=/data/bridge-results/solana-to-base-source-fixture-<sourceMessageHash>.json \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_DAEMON_STATE_PATH=/data/bridge-results/solana-to-base-paper-state \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=<sourceSlot> \
BRIDGE_DAEMON_SCAN_TO_BLOCK=<sourceSlot> \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=<sourceMessageHash> \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=<destinationBridgeMintHash> \
npm run bridge:daemon:paper:replay
```

Expected:

- `sourceEventParsed=true`
- `policyPassed=true`
- `expiredDeadline=false`
- `finalitySatisfied=true`
- `signaturesProduced=2`
- `submitPreviewCreated=true`
- `messagePersisted=true`
- `destinationTxSubmitted=false`
- message status `paper_ready_to_submit`

## Approval Rerun Evidence

Status: pending Render execution.

Approval must be rerun against:

```text
/data/bridge-results/solana-to-base-paper-state
```

Required:

- Base BridgeInbox `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- deployed Base signer set version `1`
- threshold `2`
- recovered signers match deployed signer set
- destination hash signed
- source hash preserved
- message not consumed
- message not frozen
- route enabled
- asset supported
- amount cap passes
- simulation/callStatic passes
- destination tx submitted `false`

## Simulation Result

Status: pending Render execution.

No simulation was run locally because no fresh durable paper state exists here.

## No-Submit Proof

- No Base submit command was run.
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT` was not enabled.
- `destinationTxSubmitted=false`.

## Tests Run

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- Fresh source-event generation must run on Render or another approved shell with `/data`, Solana RPC, Base RPC, signer env, and funded Solana source wallet present.
- Approval and simulation remain pending until the fresh fixture is replayed into durable paper state.
- Base destination submit remains intentionally unexecuted.

## Next Recommended PR

PR-013H should run the PR-013G Render command sequence, capture the fresh durable fixture and paper state, rerun approval/simulation, and only then prepare a separate guarded submit PR if approval is ready.
