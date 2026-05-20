# PR-012Y: Solana Devnet -> Base Sepolia Hosted Paper Replay

**Date:** 2026-05-20
**Status:** Blocked by historical message expiry; no destination transaction submitted

## Summary

PR-012Y attempted the Solana Devnet -> Base Sepolia hosted paper replay using the historical PR-010Z Solana source transaction before generating any fresh source event.

The historical source transaction is still available from Solana Devnet RPC and was converted into a non-secret source event fixture. The fixture parsed successfully in the PR-012X Solana source adapter, preserved the `bridge_out_v1_with_proof` marker, and replayed through the paper daemon. Policy rejected it because the historical message deadline has expired.

No fresh Solana source event was generated in this PR because that requires explicit operator approval.

## PR-012X Status

PR-012X provided the paper-mode foundation:

- Solana source fixture adapter
- Accepted event kind: `bridge_out_v1_with_proof`
- Unsafe event rejection: `init_bridge_v1_out`
- Route metadata: `solana-devnet -> base-sepolia`
- Exact amount normalization: 9 decimals to 18 decimals
- Base `acceptBridgeMint` submit preview in paper tests
- No destination transaction submission

## Historical Fixture Attempt

Historical source transaction:

- Solana bridge-out tx: `BQNRKsUFX5ttshDzZcjtqecsUJjt6cbvURtQtcqX4K7edtmTsNnK5kbNM3hjBwSUtwq2MQfDXhs8SKjP96S3QDQ`
- Slot: `461160894`
- Instruction: `BridgeOutV1WithProof`
- Event kind: `bridge_out_v1_with_proof`
- Source-bound marker: `bridge_out_v1_with_proof`
- Source tx status: success

The fixture includes only non-secret fields:

- source/destination route
- source tx signature and slot
- source message fields
- source message hash
- source amount and asset ID
- normalized destination amount
- destination asset ID
- finality marker

It does not include note secrets, witnesses, wallet files, private keys, RPC URLs, or operator tokens.

## Solana Source Event Details

Decoded historical `BridgeMessageV1`:

- Source message hash: `0x16a3f7f82b64a4d4d669b79118fcdaf7b720bd24d7bbced1dffc36dba3e71334`
- Source domain: `0x01000002`
- Destination domain: `0x02000002`
- Source chain ID: `0`
- Destination chain ID: `84532`
- Source amount: `1000000`
- Source asset ID: `004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0`
- Destination asset ID: `00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70`
- Source nullifier hash: `09227e90b2f12e3d85a5d4954c11ff4ad4e0e8880ba24ae517b312b41934b8af`
- Destination commitment: `25b9354128921710e487667dd3bf4aad48a8ae5f060001bd16619adca3e596d7`
- Source root: `0e38a7b160f8f048165a2a0eea0f5c0dc3ef6e0f7691db024b64fe68959a48d6`
- Source leaf index: `5`
- Nonce: `1778328126`
- Deadline: `1778331723`

## Policy And Finality Result

Replay command inputs:

- `BRIDGE_DAEMON_REPLAY_ROUTE=solana-devnet:base-sepolia`
- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_SOLANA_SOURCE_EVENTS_PATH=/tmp/pr012y-solana-source-events.json`
- Scan range: `461160800` to `461161000`

Replay result:

- Source event parsed: `true`
- Message persisted: `true`
- Policy passed: `false`
- Expired deadline: `true`
- Last error: `expired_deadline: deadline=1778331723`
- Signatures produced: `0`
- Submit preview created: `false`
- Destination tx submitted: `false`

The historical message is expired. PR-012Y did not bypass deadline policy.

## Amount Normalization

The current Solana -> Base route uses exact decimal normalization:

- Source decimals: 9
- Destination decimals: 18
- Source amount: `1000000`
- Normalized destination amount: `1000000000000000`
- Destination BridgeMint hash after normalization: `0x90947e7b7edf4d61c20e397cadce174b42bfc4053c1f56d7ae6e1341f0d6df70`

Because the source message expired, the daemon correctly stopped before signing this destination hash.

## Base Submit Preview

No Base submit preview was produced for the historical replay because policy rejected the expired source message before signing.

PR-012X tests still cover the non-expired path and prove that a valid Solana source event produces:

- Destination chain: `base-sepolia`
- Method: `BridgeInbox.acceptBridgeMint`
- Source hash preserved separately
- Destination BridgeMint hash used for signing/preview
- `dryRun=true`
- `wouldSubmit=true`
- `destinationTxSubmitted=false`

## No-Submit Proof

PR-012Y kept:

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`

Replay output had:

- `submitted: 0`
- `destinationTxSubmitted: false`
- `signaturesProduced: 0`
- `submitPreviewCreated: false`

No Base destination transaction was submitted.

## Fresh Event Result

No fresh Solana source event was generated. The next step requires explicit operator approval before producing a fresh low-value `bridge_out_v1_with_proof` source event.

## Tests Run

- `cd relayer && npm run test -- --runTestsByPath src/bridge/__tests__/solana-source-adapter.test.ts src/bridge/__tests__/daemon.test.ts src/bridge/__tests__/daemon-paper-replay.test.ts`

Additional validation for final PR closeout:

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- Historical PR-010Z replay is blocked by expired deadline.
- Live Solana RPC/log indexing is still not wired; replay uses a non-secret fixture.
- A fresh low-value Solana source event is needed to reach `paper_ready_to_submit` under current policy.
- No Base destination transaction should be submitted until a separate approval step.

## Next Recommended PR

PR-012Z — with explicit operator approval, generate one fresh low-value Solana Devnet `bridge_out_v1_with_proof` source event, export a non-secret fixture, run hosted paper replay to `paper_ready_to_submit`, and still submit no Base transaction.
