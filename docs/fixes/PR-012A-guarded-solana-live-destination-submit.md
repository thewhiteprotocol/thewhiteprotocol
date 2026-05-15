# PR-012A - Guarded Solana Live-Testnet Destination Submit

## Summary

PR-012A adds a narrow live-testnet submit command for one approved Base Sepolia -> Solana Devnet destination BridgeMint message. The command is separate from the daemon loop and remains disabled unless every live-submit gate is explicitly satisfied.

No destination transaction was submitted during local implementation.

## Approved Message

The latest hosted simulation success was for:

- Route: `base-sepolia -> solana-devnet`
- Source BridgeOut hash: `0x4a8296393fa047aa109e1c070248105fc1c7f8d90010003391af0631166005ce`
- Destination BridgeMint hash: `0xf307818bb8ebd878469f8faf7c3c074ba43f0e16909842dbcc0a4a7333c318c1`
- Signer set version: `3`
- Simulation result: `ok`
- Compute units: `310625`
- Destination tx submitted before PR-012A: `false`

The older prompt hashes (`0xf458...` / `0x372c...`) are not the latest successful hosted simulation message and must not be submitted unless replayed, re-approved, and simulated again.

## Gates Enforced

The new command is:

```bash
npm run bridge:daemon:solana:submit-approved
```

It requires:

- `BRIDGE_DAEMON_MODE=live-testnet`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`
- `BRIDGE_DAEMON_ROUTES` includes `base-sepolia:solana-devnet`
- `BRIDGE_APPROVED_MESSAGE_HASHES` includes the destination BridgeMint hash, route-scoped when possible
- persisted daemon state contains the approved destination message
- persisted source BridgeOut hash matches `BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH` when provided
- signer set version matches the Base -> Solana route version (`3`)
- message status is `paper_ready_to_submit`
- no existing `submitTxHash`
- threshold signatures are present
- destination BridgeMint hash recomputes from the persisted message

## Pre-Submit Checks

Immediately before send, the command reruns read-only Solana checks:

- program executable
- BridgeV1Config exists
- signer set v3 exists
- route config exists
- asset config exists
- pending buffer exists
- pool config exists
- Merkle tree exists
- asset vault exists
- consumed message PDA absent
- frozen message PDA absent
- commitment index PDA absent
- BridgeV1Config signer set version equals BridgeSignerSet version

If any check fails, the command does not send.

## Simulation

The command reruns `accept_bridge_v1_mint` simulation with `sigVerify=false` before send. If simulation fails, the command does not send.

## Submit Command

For the latest approved hosted message, the submit window should use:

```bash
BRIDGE_DAEMON_MODE=live-testnet \
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true \
BRIDGE_DAEMON_STATE_PATH=/tmp/bridge-daemon-pr011y-final5 \
BRIDGE_DAEMON_ROUTES=base-sepolia:solana-devnet:3 \
BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH=0x4a8296393fa047aa109e1c070248105fc1c7f8d90010003391af0631166005ce \
BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH=0xf307818bb8ebd878469f8faf7c3c074ba43f0e16909842dbcc0a4a7333c318c1 \
BRIDGE_APPROVED_MESSAGE_HASHES=base-sepolia->solana-devnet|0xf307818bb8ebd878469f8faf7c3c074ba43f0e16909842dbcc0a4a7333c318c1 \
npm run bridge:daemon:solana:submit-approved
```

Immediately after the submit attempt, set `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`.

## Confirmation And Idempotency

After send, the command:

- confirms the transaction
- persists `submitTxHash`
- persists `submittedAt`
- persists `confirmationStatus`
- checks the consumed-message PDA
- checks the commitment-index PDA as evidence the destination commitment was queued

Duplicate retries are blocked if the daemon state already has a `submitTxHash`.

## Tests Run

- `cd relayer && npm run typecheck`
- `cd relayer && npm run test -- --runInBand src/bridge/__tests__/daemon-solana-submit-approved.test.ts src/bridge/__tests__/daemon-solana-simulate.test.ts`

## Remaining Limitations

- Hosted live submit has not been executed by this implementation step.
- The submit command depends on Render state persistence; `/tmp` state is lost on restart.
- Mainnet remains unsupported.
- This is a single-message live-testnet submit command, not broad live relaying.

## Next Recommended PR

PR-012B should run the guarded submit on Render for the already simulated `0xf307...` destination message, immediately disable the live-submit flag afterward, verify consumed-message and commitment-index state, and document the Solana transaction hash.
