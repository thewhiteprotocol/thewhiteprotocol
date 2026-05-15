# PR-011X - Solana Frozen Message Lifecycle

## Summary

PR-011X fixes the Solana destination `accept_bridge_v1_mint` account lifecycle exposed by the hosted PR-011W simulation. The simulation reached the Solana Devnet program and failed before execution with Anchor error 3012 because `frozen_message` was modeled as an initialized `Account<FrozenBridgeMessage>`.

The destination transaction was not submitted.

## PR-011W Simulation Blocker

- Route: `base-sepolia -> solana-devnet`
- Source BridgeOut hash: `0xf458b7b9008624410123e2484b299f841fff071c2f9525a0b082af4d8b5b74a7`
- Destination BridgeMint hash: `0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf`
- Simulation error: `{"InstructionError":[2,{"Custom":3012}]}`
- Program log: `AnchorError caused by account: frozen_message. Error Code: AccountNotInitialized.`

## Root Cause

`accept_bridge_v1_mint` accepted `frozen_message` as `Account<FrozenBridgeMessage>`. Anchor therefore required the account to be initialized before the instruction handler could run. For normal, not-frozen messages, the frozen-message PDA is expected to be absent.

## Account Lifecycle Design

- `freeze_bridge_v1_message` remains responsible for initializing or updating `FrozenBridgeMessage`.
- `accept_bridge_v1_mint` now accepts the same deterministic frozen-message PDA as an unchecked account.
- If the PDA has empty data, the message is treated as not frozen.
- If the PDA is initialized, the handler verifies owner, discriminator, message hash, and frozen flag.
- `frozen=true` rejects with `MessageIsFrozen`.

## Security Checks

The accept path validates:

- PDA address through Anchor seeds using `bridge_frozen` and the destination BridgeMint hash.
- Program ownership when account data exists.
- `FrozenBridgeMessage` discriminator/deserialization.
- Stored `message_hash` equals the destination BridgeMint hash.
- `frozen=false` before proceeding.

Malformed initialized data is rejected with `CorruptedData`. Non-program-owned initialized data is rejected.

## Tests Added

- Main `accept_bridge_v1_mint` integration path now leaves the frozen-message PDA uninitialized and succeeds.
- Integration coverage now freezes a separate BridgeMint message with `frozen=true` and verifies accept rejects it.
- Integration coverage now passes an invalid frozen-message PDA and verifies accept rejects it.
- Existing initialized `frozen=false` paths remain covered by bridge settle/withdraw and source-with-proof localnet tests.

## Commands Run

- `cd chains/solana && npm run ci:fmt`
- `cd chains/solana && npm run ci:clippy`
- `cd chains/solana && npm run test:rust`
- `cd chains/solana && npm run build:sbf`
- `cd chains/solana && npm run test:bridge:v1:localnet`
- `cd chains/solana && npm run test:bridge:v1:settle:withdraw:localnet`
- `cd chains/solana && npm run test:bridge:v1:source:with-proof:localnet`

## Validation Results

- Format check: passed.
- Clippy: passed.
- Rust tests: 115 passed.
- SBF build: passed.
- Bridge V1 localnet: 14 passed.
- Bridge V1 settle/withdraw localnet: 14 passed after resetting local validator between scripts.
- Bridge V1 source-with-proof localnet: 19 passed.

## Devnet Upgrade

- Program ID: `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`
- Devnet upgrade: completed.
- Upgrade signature: `2omoKzZn594AyS6skD1BudNBDSKvX1xbxEonSNqyDjgRKm27KXWt4GNXUeqRM2vRubLvvrpzwyBDzNnbEonFQ1ib`

No mainnet deployment was performed.

## Hosted Simulation Rerun

Hosted Render shell rerun was not executed from this local workspace. The next hosted rerun should use the existing PR-011W approved message:

```bash
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/relayer"

BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon \
BRIDGE_DAEMON_REPLAY_ROUTE=base-sepolia:solana-devnet \
BRIDGE_DAEMON_SCAN_FROM_BLOCK=41544820 \
BRIDGE_DAEMON_SCAN_TO_BLOCK=41544860 \
BRIDGE_DAEMON_EXPECTED_SOURCE_MESSAGE_HASH=0xf458b7b9008624410123e2484b299f841fff071c2f9525a0b082af4d8b5b74a7 \
BRIDGE_DAEMON_EXPECTED_DESTINATION_MESSAGE_HASH=0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf \
npm run bridge:daemon:paper:replay

BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon \
BRIDGE_APPROVED_MESSAGE_HASHES="base-sepolia->solana-devnet|0x372c60d4efd03433d7c12e429182a83ab091ae9bc2de9eee2976dd735c8f4dcf" \
npm run bridge:daemon:solana:simulate
```

Expected: simulation no longer fails with `AccountNotInitialized` for `frozen_message`. It may succeed or expose the next exact Solana execution blocker.

## Proof No Destination Transaction Was Submitted

- PR-011X changed only the Solana program account lifecycle and reran build/tests.
- No Solana destination submit command was run.
- No live-testnet submit flag was enabled.
- No `accept_bridge_v1_mint` destination transaction was sent for the PR-011W message.

## Remaining Limitations

- Hosted simulation must be rerun from Render after the devnet upgrade.
- If simulation exposes a new program/runtime blocker, it should be handled in the next PR.
- Live destination submission remains disabled and is not production-ready.

## Next Recommended PR

PR-011Y - Rerun hosted Solana simulation after frozen-message lifecycle upgrade and address the next simulation result.
