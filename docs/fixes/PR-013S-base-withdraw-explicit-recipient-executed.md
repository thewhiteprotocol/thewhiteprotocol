# PR-013S - Base Withdraw With Explicit Recipient

## Summary

PR-013S reran the guarded Base Sepolia destination withdraw with an explicit reviewed recipient:

`0xC520f5545dc9Af65FF91470721Ee986e94a717d0`

The recipient gate passed, the durable Base destination note-state and Merkle path revalidated, proof generation and read-only simulation passed, and exactly one Base withdraw transaction was submitted. The transaction confirmed successfully. Direct post-submit checks confirmed the emitted nullifier is spent, the recipient balance increased by `1000000000000000` wei, and the vault balance decreased by `1000000000000000` wei.

## Recipient Gate

- Explicit recipient configured: true
- Recipient address: `0xC520f5545dc9Af65FF91470721Ee986e94a717d0`
- Valid EVM address: true
- Zero address: false
- Default fallback used: false

## Final Note-State Validation

`npm run bridge:validate-base-note-state` passed before withdraw:

- Source hash match: true
- Destination BridgeMint hash match: true
- Destination commitment match: true
- Amount match: true
- Asset match: true
- Has destination secret: true
- Has destination nullifier: true
- Durable path outside git: true
- Secrets printed: false

## Final Merkle Path Validation

`npm run bridge:base:validate-merkle-path` passed before withdraw:

- Destination commitment match: true
- Leaf index: `42`
- Root recomputed: true
- Path length: `20`
- Merkle root: `50015434963031949891316260787900094634376168319519755731383442155917094636`
- Path evidence hash: `779cf72cee09d21bc0912ebf8500478230718e95df535ddcf39d03aeed43921f`

## Final On-Chain Checks

The guarded command checked the Base submit tx, consumed message, inserted commitment, known root, nullifier, submitter gas balance, recipient balance, and vault balance before sending.

- Nullifier spent before: false
- Vault balance before: `30099999999000000`
- Recipient balance before: `0`

## Proof And Simulation

- Withdraw proof generated: true
- Public input checks: all true
- Withdraw simulation: passed
- Gas estimate before the live send: `357696`
- No proof, witness, note secret, nullifier secret, private key, RPC URL, or operator token was printed.

## Withdraw Transaction

- Withdraw submitted: true
- Withdraw tx: `0x62e8047f599dacc5d4e8945336d5f134e3e3e438cd2a5f5119b545995ffe0095`
- Confirmation: success
- Block number: `41835063`
- Gas used: `352310`
- Emitted event: `Withdrawal`
- Event recipient: `0xC520f5545dc9Af65FF91470721Ee986e94a717d0`
- Event amount: `1000000000000000`

## Post-Submit Checks

Direct read-only post-submit checks confirmed:

- Nullifier spent after: true
- Vault balance after: `29099999999000000`
- Recipient balance after: `1000000000000000`
- Recipient balance increased: true
- Vault balance decreased: true

The first helper run returned `blocked_post_submit_check_failed` due an immediate stale post-submit read, even though the receipt emitted `Withdrawal`. The helper was tightened to decode the `Withdrawal` event and poll post-submit state before classifying future sends.

## Duplicate Withdraw Rejection

A duplicate guarded withdraw run was attempted after confirmation and blocked before a second send:

- Duplicate status: `blocked_final_precheck_failed`
- Duplicate blocker: `nullifierSpentBefore=true`
- Duplicate withdraw submitted: false
- Second token transfer: false

## Extra AcceptBridgeMint Proof

No Base `acceptBridgeMint` command was run in PR-013S.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- This is Base Sepolia testnet evidence only.
- Preserve the durable note-state and Merkle path outside git for audit/recovery.
- Do not rerun withdraw for this note; the nullifier is spent.

## Next Recommended PR

PR-013T - archive final Solana -> Base lifecycle evidence and add an operator no-op/status command for already-withdrawn Base destination notes.
