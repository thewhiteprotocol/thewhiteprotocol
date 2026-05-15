# PR-012B - Solana Daemon Mint Settle + Withdraw

## Summary

PR-012B verifies the Solana destination privacy path after the PR-012A guarded daemon submit.

The verification script is:

```bash
cd chains/solana
npx tsx scripts/verify-daemon-mint-settle-withdraw.ts
```

It does not call `accept_bridge_v1_mint`. It requires the daemon-submitted consumed message PDA to already exist, then settles the queued destination commitment, withdraws it with a real proof, and checks duplicate withdraw rejection.

## PR-012A Submit Evidence

- Route: `base-sepolia -> solana-devnet`
- Source BridgeOut hash: `0x4a8296393fa047aa109e1c070248105fc1c7f8d90010003391af0631166005ce`
- Destination BridgeMint hash: `0xf307818bb8ebd878469f8faf7c3c074ba43f0e16909842dbcc0a4a7333c318c1`
- Submit tx: `5mbCcCp1q2qwtEcQLLrkZ9JJPWg61EKUHBzPzr5edNn61XrwnXktUy8tuEwCvaE8JafqnLagcBGWxE4EA51bJkat`
- Confirmation: `confirmed`
- Consumed PDA created: `true`
- Pending buffer updated: `true`
- Duplicate submit blocked: `true`

## Safe-Mode Verification

Before settlement/withdraw, Render must be back in safe mode:

- `BRIDGE_DAEMON_MODE=paper`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`

The PR-012B script also refuses to run if `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`.

## Pending Buffer Evidence

Pending buffer evidence is captured by `scripts/verify-daemon-mint-settle-withdraw.ts`:

- consumed message PDA exists
- destination commitment is present in `PendingDepositsBuffer`
- destination commitment is at FIFO index `0`
- pending count before settlement is recorded
- vault balance is checked before withdraw

## Settlement Proof Evidence

The script generates a real `merkle_batch_update` Groth16 proof using the current on-chain Merkle root, next leaf index, and pending destination commitment.

Captured fields:

- settlement tx
- old root
- new root
- `nextLeafIndex` before and after
- pending count before and after

## Withdraw Proof Evidence

The script generates a real withdraw proof for the destination note from the source-side bridge state.

Captured fields:

- withdraw tx
- nullifier hash
- spent nullifier PDA
- recipient token balance before and after
- vault token balance before and after

The source-side bridge state contains note material and must remain uncommitted.

## Duplicate Withdraw Rejection

After a successful withdraw, the script retries the same withdraw proof and expects rejection because the spent nullifier PDA already exists.

## Proof No Additional Bridge Submit Occurred

The PR-012B script never builds or submits `accept_bridge_v1_mint`.

Additional bridge submit tx: `none from PR-012B script`

## Commands Run

Pending Render commands:

```bash
cd relayer && npm run bridge:daemon:env:check
cd chains/solana && npx tsx scripts/verify-daemon-mint-settle-withdraw.ts
```

## Passing/Failing Results

Pending hosted run.

## Remaining Limitations

- Withdraw requires the source-side bridge state file for the exact PR-012A destination note.
- If the Render instance no longer has that state file, settlement/withdraw is blocked until the note material is restored out-of-band by the operator.

## Next Recommended PR

PR-012C should harden operator handling for private destination note state and formalize the post-submit settlement/withdraw runbook.
