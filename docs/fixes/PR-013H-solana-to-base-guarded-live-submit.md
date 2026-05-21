# PR-013H - Solana to Base Guarded Live Submit

## Summary

PR-013H attempted the final guarded pre-submit checks for the PR-013G Solana Devnet -> Base Sepolia message. The flow failed closed before any live Base transaction because the mandatory final `acceptBridgeMint` simulation now reverts with `DeadlineExpired`.

No Base destination transaction was submitted. Live submit remained disabled.

## PR-013G Approval Evidence

- Route: `solana-devnet -> base-sepolia`
- Source tx: `3uTMH3jsARmS49MF7SEqgq2Tv4ahosAdK9Vz4GP7BdPNS2mSsVDhwnTAsjiNPte6M5YCSBZwCgREqFvNJy8ZbbYF`
- Source hash: `0x0fd0e20315403767f28cac97ece9b8937c984aba43bc7f575219de681abda198`
- Destination BridgeMint hash: `0x33c44d710e08d02ebd15492219ec1fd6a15682b69440351c850af017750df93b`
- Fixture: `/data/bridge-results/solana-to-base-source-fixture-0x0fd0e20315403767f28cac97ece9b8937c984aba43bc7f575219de681abda198.json`
- Paper state: `/data/bridge-results/solana-to-base-paper-state`
- Base BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Signer set version: `1`
- Signatures: `2`
- Previous approval rerun: `approval_ready`
- Previous simulation gas estimate: `986321`

## Final Read-Only Checks

The Render precheck used commit `d18ed71` and confirmed:

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- Base Sepolia RPC configured
- Deployed signer env configured
- Durable paper state present at `/data/bridge-results/solana-to-base-paper-state/bridge-messages.json`

The approval command reviewed the expected message and confirmed:

- Source hash matched: `0x0fd0e20315403767f28cac97ece9b8937c984aba43bc7f575219de681abda198`
- Destination hash matched: `0x33c44d710e08d02ebd15492219ec1fd6a15682b69440351c850af017750df93b`
- Base BridgeInbox exists
- Signer set version matched `1`
- Global pause: `false`
- Route enabled: `true`
- Route paused: `false`
- Asset supported: `true`
- Local asset mapping set: `true`
- Message consumed: `false`
- Message frozen: `false`
- Amount within cap: `true`
- Watcher critical finding: none reported

## Simulation Result

The mandatory final simulation was rerun before enabling live submit.

- Simulation attempted: `true`
- Simulation result: blocked
- Revert: `DeadlineExpired`
- Revert selector: `0x1ab7da6b`
- Message deadline: `1779317953`
- Destination tx submitted: `false`

Because simulation failed, the guarded submit command was not run.

## Submit Command

The guarded submit command remains:

```bash
cd relayer && npm run bridge:solana-to-base:submit-approved
```

For PR-013H it was not executed, because the pre-submit simulation failed. This is the expected fail-closed behavior.

## Submit Tx Hash Or Blocker

- Submit attempted: `false`
- Submit tx hash: `null`
- Blocker: final Base `acceptBridgeMint` simulation returned `DeadlineExpired`

## Confirmation Result

- Confirmation: not applicable
- Gas used: not applicable
- Message consumed after PR-013H: `false`

## Duplicate Submit Rejection

Duplicate submit was not attempted because no first submit occurred. The destination message remains unconsumed, but the current message is no longer submit-eligible because its deadline expired.

## Live Submit Disabled After Window

No live-submit window was opened.

- Live-testnet mode enabled: `false`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT`: `false`
- Destination tx submitted: `false`

## Tests Run

Validation was run after the documentation update:

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- The PR-013G message expired before the guarded Base submit window.
- The exact destination hash `0x33c44d710e08d02ebd15492219ec1fd6a15682b69440351c850af017750df93b` must not be submitted.
- A new fresh Solana source event is required, followed by durable fixture export, paper replay, approval, immediate final simulation, and guarded submit within the deadline.

## Next Recommended PR

PR-013I should generate a fresh Solana Devnet -> Base Sepolia source event and run the durable fixture, paper replay, approval, final simulation, and guarded one-shot submit in one tightly timed operator window.
