# PR-012X: Solana Devnet -> Base Sepolia Hosted Paper Flow

**Date:** 2026-05-20
**Status:** Implementation-ready; no destination transaction submitted

## Summary

PR-012X starts the reverse hosted flow after the Base -> Solana hosted operator flow was finalized in PR-012W.

The relayer now has non-secret Solana Devnet -> Base Sepolia route metadata, exact source-to-destination amount normalization, a bounded Solana source observation adapter for hosted paper replay, and tests that prove the daemon can parse a `bridge_out_v1_with_proof` source event, reject unsafe `init_bridge_v1_out`, produce signatures, persist state, and create a Base `acceptBridgeMint` submit preview without submitting.

## Existing Solana -> Base Evidence

PR-010Z proved the live route manually:

- Source instruction: `bridge_out_v1_with_proof`
- Solana bridge-out tx: `BQNRKsUFX5ttshDzZcjtqecsUJjt6cbvURtQtcqX4K7edtmTsNnK5kbNM3hjBwSUtwq2MQfDXhs8SKjP96S3QDQ`
- Source message hash: `0x16a3f7f82b64a4d4d669b79118fcdaf7b720bd24d7bbced1dffc36dba3e71334`
- Source amount: `1000000`
- Source asset ID: `0x004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0`
- Base accept tx: `0x8035a98d328dcfc6442e5253fc86320fb9488000bc252a9fb3dd74019f706c2e`
- Base withdraw tx: `0x24f31bda6e2b415527f9f4d949ef050fd7394987a0ebaf23325076caffcff6fa`
- Signer threshold: 2-of-3 raw secp256k1 signatures

The unsafe `init_bridge_v1_out` path was not used.

## Relayer Source-Adapter Audit

Before PR-012X, policy and daemon tests already recognized Solana source event kinds:

- Accepted: `solana_bridge_out_v1_with_proof`
- Rejected/ignored: `solana_init_bridge_v1_out`
- Required marker: `sourceBoundProofMarker=bridge_out_v1_with_proof`
- Finality: Solana Devnet requires 32 confirmations in testnet policy

The missing hosted piece was a route-aware source adapter/replay path for Solana-source observations.

## Route Metadata

Added Solana Devnet -> Base Sepolia route metadata:

- Source: `solana-devnet`
- Destination: `base-sepolia`
- Source domain: `0x01000002`
- Destination domain: `0x02000002`
- Destination chain ID: `84532`
- Source chain ID: `0`
- Source asset: Solana wSOL-style asset ID `004a067d...94a82e0`
- Destination asset: Base native/EVM asset ID `00fb58d8...1d54a70`
- Signer set version: `1` for Base inbound PR-010Z compatibility
- Status: `test-only`

## Amount Normalization

The hosted paper route uses exact decimal normalization:

- Source decimals: 9
- Destination decimals: 18
- Destination amount = source amount * `10^(18 - 9)`
- Overflow and route caps are checked before signing
- Unsupported assets are rejected

Example:

- Source amount `1000000`
- Destination amount `1000000000000000`

## Paper-Mode Flow

The daemon paper replay flow now supports a Solana source fixture path:

- `BRIDGE_DAEMON_REPLAY_ROUTE=solana-devnet:base-sepolia`
- `BRIDGE_SOLANA_SOURCE_EVENTS_PATH=/path/to/non-secret-events.json`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`

The fixture adapter creates `BridgeEventObservation` records from non-secret encoded `BridgeMessageV1` data and Solana transaction metadata. It never submits destination transactions.

## Historical Replay Result

Historical live replay against PR-010Z was not run in this PR because there is no hosted Solana source event fixture/indexer artifact in the repository for the historical transaction, and the historical PR-010Z message used equal source/destination amount units before PR-012X normalization metadata.

This is an implementation-ready blocker, not a safety bypass:

- No fresh Solana source event was generated.
- No Base destination transaction was submitted.
- The next PR should either produce a non-secret Solana source event fixture from the historical transaction or create an approved fresh low-value source event for paper replay.

## Submit Preview Result

Unit coverage proves the paper daemon:

- Parses a Solana `bridge_out_v1_with_proof` event
- Passes policy when confirmations satisfy Solana finality
- Signs the normalized destination `BridgeMint` hash
- Preserves the source hash separately
- Creates a Base `BridgeInbox.acceptBridgeMint` preview
- Persists daemon state idempotently
- Leaves `destinationTxSubmitted=false`

## No-Submit Proof

PR-012X does not enable live submit, does not configure a destination adapter for submission in tests, and keeps the replay command blocked unless:

- mode is `paper`
- live submit is false
- scan range is bounded
- the source route is testnet
- Solana source events come from an explicit non-secret fixture path

## Tests Run

- `cd relayer && npm run test -- --runTestsByPath src/bridge/__tests__/solana-source-adapter.test.ts src/bridge/__tests__/daemon.test.ts src/bridge/__tests__/daemon-paper-replay.test.ts`
- `cd relayer && npm run typecheck`

Additional full-suite validation should be run before merge:

- `cd relayer && npm run test`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- Live Solana RPC/log indexing for source `bridge_out_v1_with_proof` is not yet wired; PR-012X uses explicit non-secret event fixtures for bounded replay.
- PR-010Z historical evidence is documented, but no replay fixture was generated in this PR.
- No fresh Solana source event was generated.
- No Base destination submit was performed.
- This remains testnet-only.

## Next Recommended PR

PR-012Y — create or recover a non-secret Solana source event fixture for the historical PR-010Z transaction, run hosted paper replay on Render, and verify `paper_ready_to_submit` for Solana Devnet -> Base Sepolia without submitting.
