# PR-013A - Fresh Solana -> Base Paper Replay

## Summary

PR-013A generated one fresh low-value Solana Devnet -> Base Sepolia source event using the source-bound production instruction `bridge_out_v1_with_proof`, exported a non-secret fixture, and replayed it through the hosted paper-mode daemon path.

The paper replay reached `paper_ready_to_submit` and produced a Base Sepolia `BridgeInbox.acceptBridgeMint` preview without submitting a Base destination transaction.

## PR-012Z Status

PR-012Z prepared the source-only fixture command and documented that historical replay was blocked by `expired_deadline`.

PR-013A completed the missing fresh-event execution.

## Fresh Source Fixture Command Result

Command shape:

```bash
cd chains/solana
PR012Z_SOURCE_ONLY=true \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_SOLANA_SOURCE_FIXTURE_PATH=/tmp/pr013a-solana-to-base-source-fixture.json \
npm run bridge:solana-to-base:source-fixture
```

Result:

- ok: `true`
- mode: `source_only_fixture`
- destination tx submitted: `false`
- secrets printed: `false`

## Solana Deposit Evidence

- Solana deposit tx: `1Uyz8VcRudzT9ZC2UCdpYq3uGGXH8K4PAyCgwJqpZ8groje4LXQEHnEWUJKU8kzksXohHfFZLAdeomAVqMFKDzw`

## Solana Settlement Evidence

- Solana settlement tx: `3qqpsJ1ja75RgxykdQTVvwT7WtwtdFr2AMiSQ1F8rvRMzTdkHw39i6FpPiatrFhKMnfzaWJZgdmC4EM1kocDAKVc`

## `bridge_out_v1_with_proof` Evidence

- Solana bridge out tx: `1JFuyazkGGMeTAo2Qg65XxfMCtvSwUHxad3p6kbKnsN5niecpKe3mhBfFUh9x5v89V26oJHAvrcMbra2cx4AbA2`
- Source slot: `463688066`
- Finalized confirmations at export: `33`
- Source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`

## Source Nullifier / Value-Lock Evidence

The source-only command verified:

- source nullifier spent: `true`
- source value locked: `true`
- outbound message PDA created
- spent nullifier PDA created
- source vault balance decreased by source amount
- bridge custody balance increased by source amount

No note secrets, nullifier secrets, witnesses, private keys, wallet file contents, RPC URLs with keys, or operator tokens were printed.

## Fixture Path And Non-Secret Fields

Fixture path:

```text
/tmp/pr013a-solana-to-base-source-fixture.json
```

The fixture contains only non-secret fields:

- source chain and destination chain
- source tx/signature
- slot and finalized confirmations
- event kind `bridge_out_v1_with_proof`
- `sourceBoundProofMarker=bridge_out_v1_with_proof`
- encoded/decoded `BridgeMessageV1`
- source message hash
- destination BridgeMint hash
- amount fields
- asset IDs
- source leaf index
- deadline

The fixture inspection found no private key, witness, RPC URL, wallet file, or operator token fields.

## Amount Normalization

Solana source amount:

```text
1000000
```

Base normalized destination amount:

```text
1000000000000000
```

Normalization mode:

```text
exact 9 -> 18 decimal scaling
```

## Paper Replay Result

Command shape:

```bash
cd relayer
BRIDGE_DAEMON_REPLAY_ROUTE=solana-devnet:base-sepolia \
BRIDGE_SOLANA_SOURCE_EVENTS_PATH=/tmp/pr013a-solana-to-base-source-fixture.json \
BRIDGE_DAEMON_MODE=paper \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false \
BRIDGE_DAEMON_STATE_PATH=/tmp/pr013a-solana-to-base-paper-state \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=463688066 \
BRIDGE_DAEMON_SCAN_TO_BLOCK=463688066 \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2 \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83 \
BRIDGE_SIGNER_MODE=local-dev \
BRIDGE_SIGNER_THRESHOLD=2 \
BRIDGE_SIGNER_PRIVATE_KEYS_TESTNET=present \
BRIDGE_DAEMON_SUBMIT_TARGETS=base-sepolia=0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC \
NODE_ENV=test \
npm run bridge:daemon:paper:replay
```

Result:

- ok: `true`
- status: `replayed`
- source event parsed: `true`
- policy passed: `true`
- expired deadline: `false`
- finality satisfied: `true`
- signatures produced: `2`
- submit preview created: `true`
- message persisted: `true`
- destination tx submitted: `false`
- message status: `paper_ready_to_submit`

## Base Submit Preview Result

The persisted daemon state contains:

- destination chain: `base-sepolia`
- target: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- method: `acceptBridgeMint`
- family: `evm`
- message hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- signature count: `2`
- dry run: `true`
- would submit: `true`
- submit tx hash: `null`

## Proof No Base Transaction Was Submitted

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- replay tick `submitted=0`
- `destinationTxSubmitted=false`
- persisted `submitTxHash=null`

## Tests Run

- `cd relayer && npm run test` - passed, 27 suites / 369 tests.
- `cd relayer && npm run typecheck` - passed.
- `cd relayer && npm run build` - passed.
- `cd relayer && npm run watcher:smoke` - passed.
- `cd relayer && npm run watcher:report` - passed.
- `cd chains/solana && npm run test:rust` - passed, 115 tests.

`build:sbf` was not run because no Solana program code changed.

## Remaining Limitations

- Base Sepolia destination submit remains intentionally unexecuted.
- Live hosted daemon API read-only checks were not required for this local approved-shell replay.
- The fresh source event is testnet-only evidence.

## Next Recommended PR

PR-013B: add a guarded, explicit operator approval flow for Base Sepolia destination submit of the PR-013A message, with simulation/idempotency gates and no automatic live submit.
