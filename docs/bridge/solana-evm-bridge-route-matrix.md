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
- Fixture path: `/data/bridge-results/solana-to-base-source-fixture-0x0fd0e20315403767f28cac97ece9b8937c984aba43bc7f575219de681abda198.json`
- Paper state path: `/data/bridge-results/solana-to-base-paper-state`
- Required source instruction: `bridge_out_v1_with_proof`
- Unsafe source instruction: `init_bridge_v1_out` must not be used.
- Source tx: `3uTMH3jsARmS49MF7SEqgq2Tv4ahosAdK9Vz4GP7BdPNS2mSsVDhwnTAsjiNPte6M5YCSBZwCgREqFvNJy8ZbbYF`
- Source slot: `463764443`
- Source message hash: `0x0fd0e20315403767f28cac97ece9b8937c984aba43bc7f575219de681abda198`
- Destination BridgeMint hash: `0x33c44d710e08d02ebd15492219ec1fd6a15682b69440351c850af017750df93b`
- Amount normalization: `1000000` Solana 9-decimal units -> `1000000000000000` Base 18-decimal units.
- Paper replay: passed, status `paper_ready_to_submit`.
- Policy/finality: passed.
- Signatures produced: `2`.
- Base submit preview: created for `BridgeInbox.acceptBridgeMint`.
- Approval rerun: `approval_ready`.
- Simulation: passed, gas estimate `986321`.
- Base destination tx submitted: `false`

## PR-013H Guarded Submit Precheck

- Approved source tx: `3uTMH3jsARmS49MF7SEqgq2Tv4ahosAdK9Vz4GP7BdPNS2mSsVDhwnTAsjiNPte6M5YCSBZwCgREqFvNJy8ZbbYF`
- Source message hash: `0x0fd0e20315403767f28cac97ece9b8937c984aba43bc7f575219de681abda198`
- Destination BridgeMint hash: `0x33c44d710e08d02ebd15492219ec1fd6a15682b69440351c850af017750df93b`
- Durable paper state: `/data/bridge-results/solana-to-base-paper-state`
- Final read-only checks: passed for route, asset, cap, consumed/frozen state, and signer-set version.
- Final simulation: blocked with `DeadlineExpired` before any live submit window.
- Guarded submit command: not run.
- Base destination tx submitted: `false`
- Current action: do not submit this destination hash; generate a fresh source event for the next submit attempt.

## PR-013I Fresh Guarded Submit

- Fresh source execution environment: Codespace, because Render's 2 GB web service exceeded memory during source proof generation.
- Source instruction: `bridge_out_v1_with_proof`
- Unsafe source instruction used: `false`
- Solana deposit tx: `2cSvRgUe8YCbNQgZkqwetHYsojkoAggbhkyANnRhzQWTA6npE3BX7hNXqHHhBLPUQ4URHPfykocvjtmoLjUCrwvr`
- Solana settlement tx: `3z7PkzjFBB9iSb8zLjcbcw1vDxmx4T1KkjGeD7kCS7J4Vfh2WiBzCPZhGmd71hxdqUMmCLm61CpKNMT3x9HeX4qz`
- Solana bridge out tx: `5VcEKPVobXRJrNTV6SP9PVQMYPHSCSKH4aaybqvbenyFdbLG62tHzwbTXvsgDgj7x6S3gZDpYamoBrJrMCKsKHyj`
- Source slot: `463860156`
- Source message hash: `0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e`
- Destination BridgeMint hash: `0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865`
- Deadline: `1779357790`
- Paper replay: passed, status `paper_ready_to_submit`.
- Approval rerun: `approval_ready`.
- Final simulation: passed, gas estimate `986309`.
- Time remaining before submit: `6742` seconds.
- Base submit tx: `0x72b972a211e4950d110798523f6522b402dea83306f6e12805259bdd8adec983`
- Confirmation: `success`, block `41791387`, gas used `974563`.
- Message consumed: `true`
- Duplicate submit: blocked with `already_submitted`; no second tx sent.

## PR-013J Base Destination Withdraw Preparation

- Target destination BridgeMint hash: `0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865`
- Destination commitment: `0x12888fed12c64e6d6eebd6eb6c1859feb2ca45bc64319301ba9cdc6d562feef2`
- Destination amount: `1000000000000000`
- Base submit tx confirmed: `true`
- Base submit block: `41791387`
- Message consumed: `true`
- Commitment inserted: `true`
- Bridge commitment stored: `true`
- Base `nextLeafIndex`: `42`
- Vault balance check: passed
- Destination note-state found: `false`
- Withdraw proof readiness: `blocked_note_state_missing`
- Withdraw simulation: `not_attempted`
- Withdraw tx submitted: `false`
- New read-only commands:
  - `cd chains/evm && npm run bridge:validate-base-note-state`
  - `cd chains/evm && npm run bridge:preflight-base-withdraw`

## PR-013K Note-State Recovery Classification and Submit Gate

- Final recovery search: exact PR-013I destination note-state not found.
- Recovery classification: `currently_unrecoverable_note_state_missing`
- Future backup directory: `BRIDGE_BASE_NOTE_STATE_BACKUP_DIR=/data/base-destination-note-state`
- New export/readback commands:
  - `cd chains/evm && npm run bridge:export-base-note-state`
  - `cd chains/evm && npm run bridge:base-note-state:readback-check`
- Solana -> Base guarded submit now blocks before `acceptBridgeMint` if the exact Base destination note-state is missing, invalid, under `/tmp`, inside git, or missing destination secret/nullifier metadata.
- No withdraw attempted: `true`
- No destination transaction submitted: `true`

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
