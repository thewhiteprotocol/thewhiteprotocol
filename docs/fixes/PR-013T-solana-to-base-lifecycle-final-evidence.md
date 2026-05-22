# PR-013T - Solana To Base Lifecycle Final Evidence

## Summary

PR-013T archives the completed Solana Devnet -> Base Sepolia private bridge lifecycle and hardens operator status for the already-withdrawn destination note. No transaction was submitted in PR-013T.

The target now reports `no_action_already_complete` / `already_withdrawn` when preflight or the guarded withdraw command is rerun.

## Source Event Evidence

- Route: `solana-devnet -> base-sepolia`
- Solana deposit tx: `3eQHcgwXygwpBuo4i3976oArt6oArtW3g5LxoGZHB7TFjM2NzLKcLbz8GDKwm1thnABVnRYgQ29z8ks6Wh2wXbDLfaWGc`
- Solana settlement tx: `5SGqmQVM94Bz2sd2DKtyrnrDD4e2D5kC5c1VfuLwMcvSahHtbi2uMiR4u9bARcToTq7vYouVLiYBrGaQm7qGGf9Y`
- Solana `bridge_out_v1_with_proof` tx: `54ErMCoDAw5Ed9vy5w1QyUzqCEpQB2bMmT1XuNmfZcQrby7kUinF3of59WK8Yk6nqQMrH1y6N3Wp53xSzHnAhvcr`
- Source slot: `463875732`
- Source hash: `0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3`
- Destination BridgeMint hash: `0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d`
- Destination commitment: `0x0622f68a087014d4b920cf0c8224e11ef3b129f2f58ff4414c030e143ceeaf58`

## Destination Submit Evidence

- Base `acceptBridgeMint` tx: `0x18b0d4a25ea9087630b0eed09d2399a33d16c8788290cad2d379619aedc96556`
- Confirmation: success, block `41794491`
- Gas used: `957439`
- Message consumed: true
- Commitment inserted: true
- Duplicate submit: blocked as already submitted
- Extra `acceptBridgeMint` submitted after this: false

## Destination Withdraw Evidence

- Base withdraw tx: `0x62e8047f599dacc5d4e8945336d5f134e3e3e438cd2a5f5119b545995ffe0095`
- Confirmation: success, block `41835063`
- Gas used: `352310`
- Recipient: `0xC520f5545dc9Af65FF91470721Ee986e94a717d0`
- Recipient balance before: `0`
- Recipient balance after: `1000000000000000`
- Recipient balance increased: true
- Vault balance before: `30099999999000000`
- Vault balance after: `29099999999000000`
- Vault balance decreased: true
- Nullifier spent after: true
- Duplicate withdraw rejected: true, `nullifierSpentBefore=true`
- Withdraw rerun allowed: false

## Durable Operator Evidence

- Durable source fixture: `/workspaces/thewhiteprotocol-operator-data/bridge-results/solana-to-base-source-fixture-0x0c0cc0672e9a485590d5e9db27a25413c55141fac2d9688c6caf59009b9abdc3.json`
- Durable paper state: `/workspaces/thewhiteprotocol-operator-data/bridge-results/solana-to-base-paper-state`
- Durable Base destination note-state: `/workspaces/thewhiteprotocol-operator-data/base-destination-note-state/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`
- Durable Base Merkle path evidence: `/workspaces/thewhiteprotocol-operator-data/base-merkle-paths/0xc204c9e91bc6c6e98e2fe25b6a3475cd32efc0da84b8e9017a96947bfad3c67d.json`
- Merkle path evidence hash: `779cf72cee09d21bc0912ebf8500478230718e95df535ddcf39d03aeed43921f`

The durable note-state contains private destination note material and must remain outside git.

## Operator No-Op Status

After PR-013T, `npm run bridge:preflight-base-withdraw` reports:

- `readiness=no_action_already_complete`
- `alreadyWithdrawn=true`
- `noActionRequired=true`
- `recommendedAction=do_not_rerun_withdraw`
- `withdrawAllowed=false`
- `duplicateWithdrawBlocked=true`
- `nullifierSpent=true`
- `withdrawTxSubmitted=false`
- `secretsPrinted=false`

The guarded withdraw command also returns `status=no_action_already_complete` before proof/send when rerun for the same destination.

## Tests Run

- `cd chains/evm && npm run bridge:test-base-withdraw-prep`
- `cd relayer && npm run test`
- `cd relayer && npm run typecheck`
- `cd relayer && npm run build`
- `cd relayer && npm run watcher:smoke`
- `cd relayer && npm run watcher:report`
- `cd chains/solana && npm run test:rust`

## Remaining Limitations

- This evidence is Base Sepolia / Solana Devnet testnet evidence, not mainnet readiness.
- The durable note-state and Merkle path evidence must remain outside git for operator audit and recovery.
- Do not rerun withdraw for this destination; the nullifier is already spent.

## Next Recommended PR

PR-013U - start the next Solana -> EVM route proof, or prepare the external audit evidence bundle for the completed Base Sepolia lifecycle.
