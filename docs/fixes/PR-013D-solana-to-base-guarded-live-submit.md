# PR-013D - Solana to Base Guarded Live Submit

## Summary

PR-013D adds a guarded one-shot Base Sepolia destination submit command for the approved Solana Devnet -> Base Sepolia message. The command is intentionally narrow: it requires live-testnet mode, an exact route, an approved route-scoped destination BridgeMint hash, expected source and destination hashes, a submitter key, paper state, final read-only checks, and a passing simulation before sending.

The live submit was **blocked before any transaction was attempted** because the approved PR-013A/PR-013C paper state was not present at `/tmp/pr013a-solana-to-base-paper-state` in this workspace.

## PR-013C Approval Evidence

- Source message hash: `0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2`
- Destination BridgeMint hash: `0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83`
- Base BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Signer set version: `1`
- Threshold: `2`
- Recovered deployed signers:
  - `0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820`
  - `0xbd7d34e42352BCe888394263A84CF21c85608beC`
- PR-013C simulation result: passed
- PR-013C gas estimate: `986309`
- Destination tx submitted in PR-013C: `false`

## Final Read-Only Checks

The PR-013D submit command would rerun the PR-013C approval helper immediately before submit. In this run, it could not reach final read-only Base checks because the paper state file was missing:

`paper_state_unavailable: ENOENT /tmp/pr013a-solana-to-base-paper-state`

No idempotency, route, asset, cap, or simulation gates were bypassed.

## Simulation Result

- Simulation rerun: `false`
- Simulation result: blocked before simulation
- Reason: approved paper state unavailable

## Submit Command

Added:

```bash
cd relayer
npm run bridge:solana-to-base:submit-approved
```

Required guarded environment:

```bash
BRIDGE_DAEMON_MODE=live-testnet
BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true
BRIDGE_DAEMON_ROUTES=solana-devnet:base-sepolia:1
BRIDGE_APPROVED_MESSAGE_HASHES=solana-devnet->base-sepolia|0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83
BRIDGE_SUBMIT_SOURCE_MESSAGE_HASH=0x060b4eebabf5903359ce67a06587038e70857bca9533b7c33ff521777a9a64e2
BRIDGE_SUBMIT_DESTINATION_MESSAGE_HASH=0xddcc4a5c4c4522ae983186dc8eb10f9e3ad4d2ba36f3ca31ef386d0528a62c83
BRIDGE_SOLANA_TO_BASE_APPROVAL_STATE_PATH=/tmp/pr013a-solana-to-base-paper-state
```

The command sends only after:

- exact route approval is present
- expected source and destination hashes are present
- the message is loaded from paper state
- deployed signer-set signatures match
- Base read-only checks pass
- `acceptBridgeMint` simulation passes
- the message is still not consumed or frozen

## Submit Result

- Submit attempted: `false`
- Submit tx hash: `null`
- Confirmation: `null`
- Gas used: `null`
- Message consumed: not checked due missing state
- Commitment inserted: `null`
- Duplicate submit blocked: not reached
- Destination tx submitted: `false`

## Proof Live Submit Was Disabled After Window

The attempted submit was run with command-scoped environment variables. No persistent daemon mode was changed. The command returned before any send path and reported `destinationTxSubmitted=false`.

## Tests Run

- `cd relayer && npm run test -- solana-to-base-approval`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- The approval-ready paper state from PR-013C was stored under `/tmp` and is no longer available in this workspace.
- The approved Base destination transaction was not submitted.
- Before retrying, restore or regenerate a non-secret persistent approval state for this exact destination BridgeMint hash and rerun PR-013C approval immediately before PR-013D submit.

## Next Recommended PR

PR-013E should restore the approved Solana -> Base paper state into durable operator-controlled storage, rerun signer alignment and approval simulation from that durable state, then rerun the one-shot guarded submit command.
