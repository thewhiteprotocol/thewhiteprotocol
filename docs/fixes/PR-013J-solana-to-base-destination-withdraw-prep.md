# PR-013J - Solana to Base Destination Withdraw Preparation

## Summary

PR-013J adds a read-only Base Sepolia destination withdraw/recovery preparation path for the Solana Devnet -> Base Sepolia commitment minted in PR-013I.

No withdraw was executed. The preparation is currently blocked because the exact destination note-state for the bridge-minted commitment was not found in durable storage or local metadata.

## PR-013I Submit Evidence

- Route: `solana-devnet -> base-sepolia`
- Solana `bridge_out_v1_with_proof` tx: `5VcEKPVobXRJrNTV6SP9PVQMYPHSCSKH4aaybqvbenyFdbLG62tHzwbTXvsgDgj7x6S3gZDpYamoBrJrMCKsKHyj`
- Source message hash: `0x020276efc2aaeb0886f5c815f91233cb5e503439326990076b34a3cc1bffcd1e`
- Destination BridgeMint hash: `0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865`
- Base `acceptBridgeMint` tx: `0x72b972a211e4950d110798523f6522b402dea83306f6e12805259bdd8adec983`
- Confirmation: success at block `41791387`
- Gas used: `974563`
- Duplicate submit: blocked with `already_submitted`

## Destination Commitment Evidence

- Destination commitment: `0x12888fed12c64e6d6eebd6eb6c1859feb2ca45bc64319301ba9cdc6d562feef2`
- Destination amount: `1000000000000000`
- Destination asset: `0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70`
- Base BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`

## Note-State Search Result

Added:

```bash
cd chains/evm
npm run bridge:validate-base-note-state
```

The command checks only metadata and booleans. It does not print note secrets, nullifier values, witness data, key material, or RPC values.

Result for PR-013I:

- Destination note-state found: `false`
- Durable note-state path: `null`
- Source hash match: unavailable because no candidate matched
- Destination hash match: unavailable because no candidate matched
- Destination commitment match: unavailable because no candidate matched
- Has destination secret: `false`
- Has destination nullifier: `false`

## Base Recovery/Preflight Result

Added:

```bash
cd chains/evm
npm run bridge:preflight-base-withdraw
```

Read-only preflight result for PR-013I:

- Base submit tx confirmed: `true`
- Base submit block: `41791387`
- Message consumed: `true`
- Message frozen: `false`
- Commitment inserted: `true`
- Bridge commitment stored: `true`
- BridgeMintAccepted event found: `true`
- WhiteProtocol BridgeMint event found: `true`
- Current Base Merkle root: observed
- Base `nextLeafIndex`: `42`
- Leaf index: unavailable from current preflight indexing
- Nullifier spent: unknown without destination note-state/nullifier hash
- Vault balance check: passed for the destination amount
- Recipient configured: `false`

## Withdraw Readiness

- Withdraw proof readiness: `blocked_note_state_missing`
- Withdraw simulation: `not_attempted`
- Withdraw tx submitted: `false`

The exact destination note-state is required before any proof generation, simulation, or withdraw execution can be considered. A replacement note must not be generated for the already-minted commitment.

## No-Withdraw Proof

- No `WhiteProtocol.withdraw` or bridge withdraw transaction was called.
- No Base mutation command was used.
- `withdrawTxSubmitted=false` in the validation and preflight tools.
- `secretsPrinted=false` in the validation and preflight tools.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep`
- `cd chains/evm && npm run bridge:validate-base-note-state` against PR-013I fixture/state; blocked as expected
- `cd chains/evm && npm run bridge:preflight-base-withdraw` against Base Sepolia public RPC; blocked only by missing destination note-state

Full workspace validation:

- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

Results:

- EVM targeted withdraw-prep helper test: passed
- Relayer tests: `28` suites / `391` tests passed
- Relayer typecheck: passed
- Relayer build: passed
- Watcher smoke: passed
- Watcher report: passed
- Solana Rust tests: `115` passed

## Remaining Limitations

- Exact PR-013I Base destination note-state has not been located.
- Durable destination note-state backup has not been created.
- Leaf index is not indexed by the new Base preflight helper yet.
- Nullifier spent status cannot be checked without the destination nullifier hash.
- Withdraw proof generation and withdraw simulation remain intentionally blocked.

## Next Recommended PR

PR-013K should recover or locate the exact destination note-state for destination hash `0x67804661cc1d5fe7c0a54cc1c572a8c990d5ef5137580898d2c58f5b8e3c6865`, back it up to durable storage outside git, then rerun Base withdraw preflight. Only a later explicit PR should approve withdraw proof generation or execution.
