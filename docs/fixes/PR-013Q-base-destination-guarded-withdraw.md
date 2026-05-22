# PR-013Q - Base Destination Guarded Withdraw

## Summary

PR-013Q added a guarded one-shot Base Sepolia destination withdraw command for the Solana -> Base bridge-minted commitment, then ran the final gates. The withdraw was not submitted because the operator environment does not configure an explicit withdraw recipient.

The command fails closed before sending if the recipient is missing, the approved destination hash is missing or mismatched, the note-state or Merkle path is invalid, the nullifier is already spent, the root is not known, the vault balance is insufficient, proof generation fails, or final simulation fails.

## PR-013P Readiness Evidence

- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`
- Base submit tx: `0x18b0d4a25ea9087630b0eed09d2399a33d16c8788290cad2d379619aedc96556`
- Leaf index: `42`
- Merkle root: `50015434963031949891316260787900094634376168319519755731383442155917094636`
- Durable Base note-state: `/workspaces/thewhiteprotocol-operator-data/base-destination-note-state/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`
- Durable Merkle path evidence: `/workspaces/thewhiteprotocol-operator-data/base-merkle-paths/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`
- PR-013P proof generation: passed in memory.
- PR-013P read-only withdraw simulation: passed.
- PR-013P gas estimate: `329772`

## Final Note-State Validation

`npm run bridge:validate-base-note-state` passed with:

- Source hash match: true
- Destination hash match: true
- Destination commitment match: true
- Amount match: true
- Asset match: true
- Has destination secret: true
- Has destination nullifier: true
- Durable path: true
- Outside repo: true
- Secrets printed: false

The readback check also passed.

## Final Merkle Path Validation

`npm run bridge:base:validate-merkle-path` passed with:

- Destination hash match: true
- Destination commitment match: true
- Leaf index: `42`
- Path length: `20`
- Root recomputed: true
- Proof input consumable: true
- Path evidence hash: `779cf72cee09d21bc0912ebf8500478230718e95df535ddcf39d03aeed43921f`

## Final Nullifier And Vault Checks

The read-only Base preflight confirmed:

- Base submit tx confirmed: true
- Message consumed: true
- Commitment inserted: true
- Leaf index: `42`
- Nullifier spent: false
- Vault balance before: `30099999999000000`
- Vault balance sufficient for required amount `1000000000000000`: true
- Recipient configured: false

## Proof Generation Result

The guarded withdraw command did not generate a new proof during PR-013Q because it blocked before proof generation on the missing recipient gate. PR-013P already proved that the same durable note-state and Merkle path can generate a withdraw proof in memory.

## Simulation Result

The guarded withdraw command did not rerun final simulation because the recipient gate failed first. This is intentional: the final simulation must use the intended recipient, and no intended recipient is configured in the operator environment.

## Withdraw Tx Result

- Withdraw submitted: false
- Withdraw tx: null
- Confirmation: not attempted
- Gas used: null
- Nullifier spent after: not changed
- Recipient balance after: not checked
- Vault balance after: not changed

## Duplicate Withdraw Rejection

Duplicate withdraw was not attempted because no first withdraw was submitted. The destination nullifier remains unspent.

## Extra AcceptBridgeMint Proof

No Base `acceptBridgeMint` command was run in PR-013Q. The only guarded execution command attempted was `bridge:base:submit-withdraw`, and it failed before any write transaction.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep` - passed
- `cd relayer && npm run typecheck` - passed

Additional full validation is still required after the operator configures an explicit withdraw recipient and before any reattempt.

## Remaining Limitations

- `BRIDGE_WITHDRAW_RECIPIENT` or `BASE_WITHDRAW_RECIPIENT` is not configured.
- The final withdraw simulation and tx submit were intentionally not attempted without an explicit recipient.
- The durable note-state and Merkle path must remain outside git.
- Before reattempting, rerun note-state validation, Merkle path validation, Base preflight, proof generation, and final simulation using the configured recipient.

## Next Recommended PR

PR-013R - Configure explicit Base destination withdraw recipient, rerun final simulation with that recipient, and execute the guarded one-shot Base withdraw.
