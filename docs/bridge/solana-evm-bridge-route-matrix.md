# Solana ↔ EVM Private Bridge Route Matrix

**Date:** 2026-05-09
**Status:** Solana destination and Solana -> Base source path proven on testnets

## Domains

| Chain | Testnet | Domain ID | Chain ID Convention |
| --- | --- | ---: | ---: |
| Solana | Devnet | `0x01000002` / `16777218` | `0` |
| Base | Sepolia | `0x02000002` / `33554434` | `84532` |

## Proven Routes

| Route | Status | Source Path | Destination Path | Evidence |
| --- | --- | --- | --- | --- |
| Base Sepolia -> Solana Devnet | Proven | EVM `bridgeOutV1` | Solana `accept_bridge_v1_mint` -> settle -> withdraw | `docs/fixes/PR-010W-live-base-to-solana-normalized-rerun.md` |
| Solana Devnet -> Base Sepolia | Proven live; hosted paper replay foundation added | Solana `bridge_out_v1_with_proof` | Base `acceptBridgeMint` -> withdraw | `docs/fixes/PR-010Z-solana-to-base-private-bridge-e2e.md`, `docs/fixes/PR-012X-solana-to-base-hosted-paper-flow.md` |

## Hosted Paper Route Metadata

| Route | Source decimals | Destination decimals | Normalization | Destination submit preview |
| --- | ---: | ---: | --- | --- |
| Solana Devnet -> Base Sepolia | 9 | 18 | `exact-decimal`; destination amount = source amount * `10^9` | Base `BridgeInbox.acceptBridgeMint` |

## Pending Solana Source Routes

| Route | Status | Blocker / Next Step |
| --- | --- | --- |
| Solana Devnet -> Ethereum Sepolia | Not yet run | Configure Ethereum inbound Solana asset and run live E2E. |
| Solana Devnet -> BNB Chain Testnet | Not yet run | Configure BNB inbound Solana asset and run live E2E. |
| Solana Devnet -> Polygon Amoy | Not yet run | Configure Polygon inbound Solana asset and run live E2E. |

## PR-010Z Solana -> Base Evidence

- Solana deposit tx: `yomzcemuB7fsKBTmsVP9coXa9RsGQ6myy4cUAebk8baRdxKRXBh4Y3CirGhBxdj677XnLVHhHz5wKfLvMP1HQcW`
- Solana settlement tx: `2UZXPpgxtY5eqB3N3QtXk8rHY2AdDssmVUfR7fmpWY7GLWyuMqqdPZRZWyyCLV3FXhuQ7T9i2iohjxA6wNECjWwR`
- Solana bridge-out tx: `BQNRKsUFX5ttshDzZcjtqecsUJjt6cbvURtQtcqX4K7edtmTsNnK5kbNM3hjBwSUtwq2MQfDXhs8SKjP96S3QDQ`
- Message hash: `0x16a3f7f82b64a4d4d669b79118fcdaf7b720bd24d7bbced1dffc36dba3e71334`
- Base accept tx: `0x8035a98d328dcfc6442e5253fc86320fb9488000bc252a9fb3dd74019f706c2e`
- Base withdraw tx: `0x24f31bda6e2b415527f9f4d949ef050fd7394987a0ebaf23325076caffcff6fa`

## PR-012Y Hosted Paper Replay Attempt

- Historical PR-010Z transaction was reconstructed into a non-secret Solana source fixture.
- The paper daemon parsed and persisted the source event.
- Replay was blocked by deadline policy: historical deadline `1778331723` is expired.
- No signatures were produced.
- No Base `acceptBridgeMint` preview was produced for the expired historical message.
- No Base destination transaction was submitted.

## PR-012Z Fresh Source Fixture Command

- Added `cd chains/solana && npm run bridge:solana-to-base:source-fixture`.
- The command runs only the Solana source side with `PR012Z_SOURCE_ONLY=true`.
- It uses `bridge_out_v1_with_proof`, not `init_bridge_v1_out`.
- It computes Base destination amount with exact 9-to-18 normalization.
- It computes the Base destination commitment with the normalized destination amount.
- It exports a non-secret fixture for hosted paper replay.
- Local fresh execution was not completed because the required escalated devnet source run was rejected; no Base destination transaction was submitted.

## PR-013A Fresh Source Paper Replay

- Fresh source event generated with `bridge_out_v1_with_proof`.
- Solana deposit tx: `1Uyz8VcRudzT9ZC2UCdpYq3uGGXH8K4PAyCgwJqpZ8groje4LXQEHnEWUJKU8kzksXohHfFZLAdeomAVqMFKDzw`
- Solana settlement tx: `3qqpsJ1ja75RgxykdQTVvwT7WtwtdFr2AMiSQ1F8rvRMzTdkHw39i6FpPiatrFhKMnfzaWJZgdmC4EM1kocDAKVc`
- Solana bridge out tx: `1JFuyazkGGMeTAo2Qg65XxfMCtvSwUHxad3p6kbKnsN5niecpKe3mhBfFUh9x5v89V26oJHAvrcMbra2cx4AbA2`
- Source slot: `463688066`
- Source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- Paper replay status: `paper_ready_to_submit`
- Signatures produced: `2`
- Base preview: `BridgeInbox.acceptBridgeMint`
- Base destination tx submitted: `false`

## PR-013B Guarded Base Approval Readiness

- Message reviewed from PR-013A paper state.
- Source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- Base BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Base read-only checks: route enabled, asset supported, message not consumed, message not frozen, amount within cap.
- Base simulation result: blocked with `InvalidSigner`.
- Approval status: not ready for live submit.
- Base destination tx submitted: `false`

## PR-013C Signer Set Alignment

- The same destination BridgeMint hash was re-signed with deployed Base signer-set keys.
- Deployed Base signer set version: `1`
- Deployed threshold: `2`
- Recovered deployed signers:
  - `0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820`
  - `0xbd7d34e42352BCe888394263A84CF21c85608beC`
- `InvalidSigner` resolved: `true`
- Base `acceptBridgeMint` simulation: passed
- Gas estimate: `986309`
- Base destination tx submitted: `false`

## PR-013D Guarded One-Shot Base Submit

- Guarded submit command: `cd relayer && npm run bridge:solana-to-base:submit-approved`
- Required route scope: `solana-devnet:base-sepolia:1`
- Required approved destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- Required source hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Submit result: blocked before send because the approval-ready paper state path `/tmp/pr013a-solana-to-base-paper-state` was unavailable.
- Base destination tx submitted: `false`

## PR-013E Durable Approval State Restore

- Required durable fixture: `/data/bridge-results/solana-to-base-source-fixture-0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2.json`
- Required durable paper state: `/data/bridge-results/solana-to-base-paper-state`
- Local restore result: blocked because `/data` is not mounted and the old `/tmp/pr013a-solana-to-base-source-fixture.json` is unavailable.
- Public source transaction status: finalized at slot `463688066`.
- Approval rerun: not attempted without durable paper state.
- Guarded submit attempted: `false`
- Base destination tx submitted: `false`

## PR-013F Fixture Reconstruction

- Fixture reconstruction command: `cd relayer && npm run bridge:solana-to-base:fixture-from-tx`
- Source tx: `1JFuyazkGGMeTAo2Qg65XxfMCtvSwUHxad3p6kbKnsN5niecpKe3mhBfFUh9x5v89V26oJHAvrcMbra2cx4AbA2`
- Source slot: `463688066`
- Source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- Fixture reconstruction: passed from finalized Solana transaction.
- Replay result: rejected with `expired_deadline`.
- Approval rerun: not attempted.
- Base destination tx submitted: `false`

## PR-013G Fresh Durable Source Fixture

- Fresh source command: `cd chains/solana && npm run bridge:solana-to-base:source-fixture`
- Durable fixture directory: `/data/bridge-results`
- Fixture naming: `solana-to-base-source-fixture-<sourceMessageHash>.json`
- Required source instruction: `bridge_out_v1_with_proof`
- Unsafe source instruction: `init_bridge_v1_out` must not be used.
- Local status: pending Render execution because `/data` and hosted RPC/signer/wallet env were absent locally.
- Paper replay: pending fresh source event.
- Approval rerun: pending fresh paper state.
- Base destination tx submitted: `false`

## Production Relayer Policy

- For Solana source routes, production relayers must only relay events produced by `bridge_out_v1_with_proof`.
- Production relayers must ignore `init_bridge_v1_out`; it remains message-level/test-only.
- Solana source messages must be checked against the `OutboundBridgeMessage` PDA and spent nullifier PDA before relay.
- The Base destination path must reject duplicate `acceptBridgeMint` through `consumedMessageHashes`.

## Remaining Limitations

- `public_data_hash` is still weak/dummy-constrained in the current circuit.
- Solana -> EVM hosted paper metadata now uses exact 9-to-18 decimal normalization. PR-013A proved `paper_ready_to_submit` against a fresh non-expired Solana source event without submitting the Base destination transaction.
- Base Sepolia deployer balance after PR-010Z was `0.000150343373443225` ETH; top up before additional live Base submissions.
- Current evidence is testnet-only and is not mainnet readiness.
