# PR-013R - Base Withdraw Explicit Recipient

## Summary

PR-013R reran the guarded Base Sepolia destination withdraw path with an explicit recipient gate. The operator environment still does not configure `BRIDGE_WITHDRAW_RECIPIENT` or `BASE_WITHDRAW_RECIPIENT`, so the command failed closed before proof generation, final simulation, or transaction submission.

The guarded command now also rejects an invalid recipient and the zero address. It does not default to the deployer, submitter, operator, or pool authority.

## Explicit Recipient Gate

- `BRIDGE_WITHDRAW_RECIPIENT`: not configured
- `BASE_WITHDRAW_RECIPIENT`: not configured
- Recipient address: null
- Recipient gate result: `blocked_withdraw_recipient_missing`
- Default fallback used: false

Because the recipient is missing, no proof was generated and no withdraw simulation or transaction was attempted.

## Final Note-State Validation

Not rerun in PR-013R after the missing-recipient gate failed. PR-013Q and PR-013P already validated the durable note-state for this target:

- Source hash: `0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3`
- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`
- Durable note-state path: `/workspaces/thewhiteprotocol-operator-data/base-destination-note-state/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`

## Final Merkle Path Validation

Not rerun in PR-013R after the missing-recipient gate failed. PR-013Q and PR-013P already validated the durable Merkle path:

- Leaf index: `42`
- Merkle root: `50015434963031949891316260787900094634376168319519755731383442155917094636`
- Durable path evidence: `/workspaces/thewhiteprotocol-operator-data/base-merkle-paths/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`

## Final On-Chain Checks

Not rerun in PR-013R after the missing-recipient gate failed. The PR-013Q preflight remained:

- Base submit tx confirmed: true
- Message consumed: true
- Commitment inserted: true
- Nullifier spent before: false
- Vault balance before: `30099999999000000`

## Proof Generation Result

- Withdraw proof generated: false
- Reason: blocked before proof generation on missing explicit recipient
- Witness/proof files committed: false

## Simulation Result

- Withdraw simulation: not attempted
- Reason: blocked before simulation on missing explicit recipient
- Gas estimate: null

## Withdraw Tx Result

- Withdraw submitted: false
- Withdraw tx: null
- Confirmation: not attempted
- Gas used: null
- Nullifier spent after: not checked after send because no send occurred
- Recipient balance increased: false
- Vault balance decreased: false

## Duplicate Withdraw Rejection

Duplicate withdraw was not attempted because no initial withdraw was submitted.

## Extra AcceptBridgeMint Proof

No Base `acceptBridgeMint` command was run in PR-013R.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep` - passed
- Full validation suite is recorded in the terminal summary.

## Remaining Limitations

- An explicit reviewed Base Sepolia recipient must be configured before any withdraw attempt.
- After configuring the recipient, rerun note-state validation, Merkle path validation, on-chain preflight, proof generation, final simulation, and the guarded live submit command.

## Next Recommended PR

PR-013S - Configure a reviewed Base Sepolia withdraw recipient and execute the guarded one-shot withdraw after all final gates pass.
