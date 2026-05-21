# PR-013I - Fresh Solana to Base Guarded Submit

## Summary

PR-013I generated a fresh low-value Solana Devnet -> Base Sepolia source event with `bridge_out_v1_with_proof`, replayed it through paper mode, reran Base approval and simulation, and submitted exactly one guarded Base Sepolia `BridgeInbox.acceptBridgeMint` transaction for the fresh destination BridgeMint hash.

Render's 2 GB web service was not sufficient for source-side proof generation. The proof-heavy source fixture was generated from Codespace, while preserving the same safety constraints: no `init_bridge_v1_out`, no broad live relaying, and no Base submit until replay, approval, and simulation passed.

## PR-013H Expiry Blocker

PR-013H failed closed because the previous destination BridgeMint hash expired before the final submit window:

- Expired destination hash: `0x33c44d710e08d02ebd15492219ec1fd6a15682b69440351c850af017750df93b`
- Simulation result: `DeadlineExpired`
- Submit attempted: `false`
- Destination tx submitted: `false`

That expired destination hash was not submitted in PR-013I.

## Fresh Source Event Evidence

- Solana pre-existing pending settlement tx: `61m2NXTvcACBdi5Cm6sYmCU9okxwBH2mTFx4a76UJSL85R78HLeZB1eHkEMUaeFcxiQL8XBn8vL6kDUTvhbkQCR6`
- Solana deposit tx: `2cSvRgUe8YCbNQgZkqwetHYsojkoAggbhkyANnRhzQWTA6npE3BX7hNXqHHhBLPUQ4URHPfykocvjtmoLjUCrwvr`
- Solana settlement tx: `3z7PkzjFBB9iSb8zLjcbcw1vDxmx4T1KkjGeD7kCS7J4Vfh2WiBzCPZhGmd71hxdqUMmCLm61CpKNMT3x9HeX4qz`
- Solana `bridge_out_v1_with_proof` tx: `5VcEKPVobXRJrNTV6SP9PVQMYPHSCSKH4aaybqvbenyFdbLG62tHzwbTXvsgDgj7x6S3gZDpYamoBrJrMCKsKHyj`
- Source slot: `463860156`
- Source message hash: `0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e`
- Destination BridgeMint hash: `0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865`
- Source amount: `1000000`
- Normalized destination amount: `1000000000000000`
- Deadline: `1779357790`
- Source nullifier spent: `true`
- Source value locked: `true`

## Durable Fixture Evidence

- Fixture path used for the timed Codespace window: `/tmp/pr013i-bridge-results/solana-to-base-source-fixture-0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e.json`
- The fixture contains only non-secret source/destination route, tx, slot/finality, message hash, destination hash, amount, asset, deadline, and source proof marker fields.
- It does not contain wallet files, private keys, RPC URLs, operator tokens, witnesses, or note secrets.
- Render `/data` fixture generation was not used because the 2 GB web service exceeded memory during source proof generation.

## Durable Paper Replay Evidence

- Paper state path used for the timed Codespace window: `/tmp/pr013i-solana-to-base-paper-state`
- Replay route: `solana-devnet->base-sepolia`
- Source event parsed: `true`
- Policy passed: `true`
- Expired deadline: `false`
- Finality satisfied: `true`
- Signatures produced: `2`
- Base submit preview: created
- Status: `paper_ready_to_submit`
- Destination tx submitted during replay: `false`

## Approval Rerun Evidence

The approval rerun passed before submit:

- Readiness: `approval_ready`
- Base BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Signer set version: `1`
- Signature count: `2`
- Route enabled: `true`
- Route paused: `false`
- Asset supported: `true`
- Local asset mapping set: `true`
- Message consumed before submit: `false`
- Message frozen: `false`
- Amount cap passed: `true`

## Final Simulation Result

- Final simulation attempted: `true`
- Final simulation result: passed
- Gas estimate: `986309`
- Time remaining before submit: `6742` seconds

## Guarded Submit Result

- Submit command: `cd relayer && npm run bridge:solana-to-base:submit-approved`
- Live-testnet mode: command-scoped only
- Live submit enabled: command-scoped only
- Guarded submit attempted: `true`
- Base submit tx: `0x72b972a211e4950d110798523f6522b402dea83306f6e12805259bdd8adec983`
- Confirmation: `success`
- Block number: `41791387`
- Gas used: `974563`
- Destination tx submitted: `true`

## Live Submit Disabled Proof

The submit command was run with command-scoped live env only. The command report returned:

- `liveSubmitDisabledAfterWindow=true`

No broad live relaying was enabled.

## Message Consumed Result

Read-only post-submit checks confirmed:

- Destination hash consumed: `true`
- Source hash consumed: `false`
- Receipt status: `success`
- Receipt logs: `2`

## Duplicate Submit Rejection

A duplicate guarded submit invocation was attempted only to verify idempotency. It blocked before sending:

- Duplicate status: `already_submitted`
- Submit attempted: `false`
- Error: `message_already_has_submit_tx_hash`

The post-submit approval check also reports `base_message_consumed` and simulation reverts with `MessageAlreadyConsumed`, which is the expected no-op/blocked duplicate behavior.

## Tests Run

Validation was run after the submit wrapper fix and documentation update:

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- Render's 2 GB web service is not suitable for source-side proof generation. Use Codespace or a larger one-off worker for fresh Solana source events.
- The submit wrapper needed a small fix so its internal read-only approval rerun uses paper-mode semantics while the outer command remains live-testnet guarded.
- The first submit command's immediate consumed read was stale, but the transaction receipt succeeded and a subsequent read confirmed the destination hash consumed.

## Next Recommended PR

PR-013J should prepare the Base Sepolia destination withdrawal/recovery flow for this consumed Solana -> Base message, including durable Base-side note-state handling and a no-secret operator runbook.
