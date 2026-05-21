# PR-013O - Solana to Base Destination Withdraw Prep

## Summary

PR-013O prepared the Base Sepolia destination withdraw/recovery path for the PR-013N bridge-minted commitment. No withdraw transaction was sent.

Current status: blocked at Merkle path evidence. The durable Base destination note-state validates, the Base submit transaction is confirmed, the message is consumed, the commitment is inserted, the destination leaf index is derived as `42`, and the destination nullifier is unspent. Withdraw proof generation is not ready because the preflight does not yet have a Merkle path/indexer snapshot for that leaf.

## PR-013N Submit Evidence

- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`
- Source hash: `0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3`
- Base submit tx: `0x18b0d4a25ea9087630b0eed09d2399a33d16c8788290cad2d379619aedc96556`
- Confirmation: success, block `41794491`
- Gas used: `957439`
- Message consumed: `true`
- Commitment inserted: `true`
- Duplicate submit: blocked as `already_submitted`

## Durable Base Note-State Validation

Durable Base note-state path:

```text
/workspaces/thewhiteprotocol-operator-data/base-destination-note-state/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json
```

Validation result:

- Source hash match: `true`
- Destination hash match: `true`
- Destination commitment match: `true`
- Amount match: `true`
- Asset match: `true`
- Has destination secret: `true`
- Has destination nullifier: `true`
- Durable path: `true`
- Outside repo: `true`
- Secrets printed: `false`

Readback result: `readback_valid`.

## Base Recovery Preflight Result

- Base submit tx confirmed: `true`
- Base submit block: `41794491`
- Message consumed: `true`
- Message frozen: `false`
- Bridge commitment stored: `true`
- `BridgeMintAccepted` event found: `true`
- `BridgeMint` event found: `true`
- Commitment inserted: `true`
- Current Base Merkle root: `50015434963031949891316260787900094634376168319519755731383442155917094636`
- Current Base `nextLeafIndex`: `43`
- Vault balance check: passed
- Recipient configured: `false`
- Preflight checks passed: `true`

## Leaf Index And Membership Evidence

Leaf index: `42`

Evidence:

- `nextLeafIndex` at block `41794490`: `42`
- `nextLeafIndex` at submit block `41794491`: `43`
- The submit receipt contains the expected `BridgeMintAccepted` and `BridgeMint` events for the exact destination hash/commitment.
- The commitment is stored in `WhiteProtocol.bridgeCommitments`.

Membership evidence status: `leaf_index_derived_from_submit_block_nextLeafIndex_delta`.

Remaining membership blocker: no Merkle path/indexer snapshot was available from the current preflight output, so proof inputs cannot be built safely yet.

## Withdraw Proof Readiness

Withdraw proof readiness: `blocked_merkle_path_unavailable`.

The durable note-state and leaf index are available, and the destination nullifier check reports `false` for spent status. Proof generation was not attempted because the helper does not yet have Merkle path evidence for leaf `42`.

## Withdraw Simulation

Withdraw simulation: `not_attempted_missing_merkle_path`.

No callStatic/simulation was attempted because proof generation did not produce a proof.

## No-Withdraw Proof

- Withdraw tx submitted: `false`
- No Base withdraw command was run.
- No witness, proof, private key, signer key, note secret, nullifier secret, wallet file, RPC URL, or operator token was printed or committed.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep` - passed
- `cd relayer && npm run test` - passed, 28 suites / 398 tests
- `cd relayer && npm run typecheck` - passed
- `cd relayer && npm run build` - passed
- `cd relayer && npm run watcher:smoke` - passed
- `cd relayer && npm run watcher:report` - passed
- `cd chains/solana && npm run test:rust` - passed, 115 tests

## Remaining Limitations

- Withdraw remains blocked until a Base Merkle path/indexer snapshot for leaf `42` is available.
- Recipient configuration is still unset in the preflight environment.
- No withdraw proof or withdraw simulation has been generated.

## Next Recommended PR

PR-013P should add Base destination Merkle path recovery for the bridge-minted leaf, then generate a withdraw proof and run read-only withdraw simulation without sending a withdraw transaction.
