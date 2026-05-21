# PR-013P - Base Merkle Path Withdraw Simulation

## Summary

PR-013P recovered the Base Sepolia Merkle path for the Solana -> Base bridge-minted destination commitment, generated the destination withdraw proof in memory, and ran a read-only Base withdraw simulation. No withdraw transaction was submitted.

Status: withdraw simulation ready.

## PR-013O Blocker

PR-013O validated the durable Base destination note-state and derived leaf index `42`, but blocked withdraw proof readiness because no Merkle path/indexer evidence was available.

## Merkle Path Recovery Method

The recovery command uses read-only Base Sepolia state:

- `WhiteProtocol.getLastRoot()`
- `WhiteProtocol.nextLeafIndex()`
- `WhiteProtocol.filledSubtrees(i)`
- `WhiteProtocol.zeros(i)`
- the PR-013N submit receipt

Because the current `nextLeafIndex` still matched the submit-block `nextLeafIndex`, the existing E2E tree helper pattern could safely compute the path for the bridge-minted leaf from current `filledSubtrees` and `zeros`. The command also required the submit receipt to contain the matching `BridgeMint` event and verified the stored bridge commitment.

## Event And Log Range Used

- Base submit tx: `0x18b0d4a25ea9087630b0eed09d2399a33d16c8788290cad2d379619aedc96556`
- Submit block: `41794491`
- Event range: `41794491-41794491`
- Event evidence: matching `BridgeMint` event in the submit receipt.
- Tree state evidence: current `nextLeafIndex` remained `43`, matching the submit-block state after insertion.

## Leaf Index Evidence

- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`
- Leaf index: `42`
- `nextLeafIndex` before submit: `42`
- `nextLeafIndex` at submit block: `43`
- Membership evidence: `leaf_index_derived_from_submit_block_nextLeafIndex_delta`

## Merkle Root And Path Validation

- Merkle root: `50015434963031949891316260787900094634376168319519755731383442155917094636`
- Tree depth: `20`
- Root recomputed from path: `true`
- Root known on-chain: `true`
- Path length valid: `true`
- Proof input consumable: `true`

Durable non-secret path evidence:

```text
/workspaces/thewhiteprotocol-operator-data/base-merkle-paths/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json
```

Path evidence hash:

```text
779cf72cee09d21bc0912ebf8500478230718e95df535ddcf39d03aeed43921f
```

The command did not print path elements in logs.

## Withdraw Proof Readiness

- Durable note-state validation/readback: passed
- Merkle path validation: passed
- Proof input built: `true`
- Withdraw proof generated: `true`
- Public input checks:
  - root: `true`
  - nullifier hash: `true`
  - asset: `true`
  - recipient: `true`
  - amount: `true`
  - relayer: `true`
  - relayer fee: `true`
- Nullifier spent before simulation: `false`

The proof was generated in memory only. No proof, witness, note-state, private key, or secret material was committed.

## Withdraw Simulation Result

- Withdraw simulation: passed
- Gas estimate: `329772`
- Simulation error: `null`
- Withdraw tx submitted: `false`

## No-Withdraw Proof

- No `withdraw` transaction was sent.
- No Base `acceptBridgeMint` transaction was sent.
- `withdrawTxSubmitted=false` in all PR-013P command outputs.
- `secretsPrinted=false` in all PR-013P command outputs.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep` - passed
- `cd relayer && npm run test` - passed, 28 suites / 398 tests
- `cd relayer && npm run typecheck` - passed
- `cd relayer && npm run build` - passed
- `cd relayer && npm run watcher:smoke` - passed
- `cd relayer && npm run watcher:report` - passed
- `cd chains/solana && npm run test:rust` - passed, 115 tests

## Remaining Limitations

- The recovered path is valid while no later Base tree insertions have advanced `nextLeafIndex` beyond `43`; if the tree advances before withdraw execution, regenerate path evidence before proof generation.
- The withdraw transaction remains unsubmitted and needs a separate explicit guarded execution PR.
- The durable Base destination note-state and Merkle path evidence must remain outside git and preserved until withdraw completion.

## Next Recommended PR

PR-013Q should run a guarded one-shot Base destination withdraw using the validated note-state, recovered Merkle path, and proof-generation/simulation flow from PR-013P.
