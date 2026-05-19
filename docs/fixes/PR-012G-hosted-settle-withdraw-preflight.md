# PR-012G - Hosted Settle/Withdraw Preflight

## Summary

PR-012G adds a hosted-safe preflight command for the post-accept Base Sepolia -> Solana Devnet settlement and withdraw workflow. The command is read-only and verifies proving artifacts, durable note-state, pending/FIFO state, wallet authority, and result export before an operator runs the mutating settle/withdraw script.

No bridge accept, settlement, or withdraw transaction is submitted by this PR.

## What PR-012F Completed

PR-012F completed the full hosted path:

- Durable note-state backup under `/data/white-bridge-note-state`
- Guarded Solana destination submit
- FIFO prefix settlement
- Target settlement
- Withdraw from bridge-minted note
- Duplicate withdraw rejection
- No additional bridge accept submit

PR-012F also showed that hosted settlement/withdraw depends on correct manual setup of zkey proving artifacts and FIFO planning. PR-012G automates that preflight.

## Zkey / Persistent Disk Policy

The hosted app must keep proving keys on durable operator storage, not in git and not under `/tmp`.

Expected hosted paths:

- `/data/circuit-artifacts/merkle_batch_update/merkle_batch_update.zkey`
- `/data/circuit-artifacts/withdraw/withdraw.zkey`

Expected SHA256:

- `merkle_batch_update.zkey`: `107f6455153a9ca622ede842655f5e7b55aa0824b3d59c8ed050937b6966aac9`
- `withdraw.zkey`: `cc38b845b76e2cc66a0f027540c96669b162531f64bd51a675c18f62647e71d0`

The preflight command verifies that zkey symlinks resolve to the configured artifact directory and that hashes match.

## Artifact Preflight

Added command:

- `cd chains/solana && npm run bridge:preflight:settle-withdraw`

The command checks:

- `merkle_batch_update.zkey` exists
- `withdraw.zkey` exists
- `merkle_batch_update.wasm` exists
- `withdraw.wasm` exists
- zkey symlinks resolve
- persistent-disk copies exist
- expected SHA256 values match

If any artifact is missing or mismatched, readiness is `blocked_artifacts`.

## Durable Note-State Preflight

The command requires:

- `BRIDGE_NOTE_STATE_BACKUP_DIR` set
- backup dir not under `/tmp`
- backup dir outside git
- destination note-state file exists for the exact destination BridgeMint hash
- source hash match
- destination hash match
- destination commitment match
- amount match
- asset match when provided
- `hasDestSecret=true`
- `hasDestNullifier=true`

Only booleans and non-secret hashes/paths are printed. Secret values are not printed.

## Pending / FIFO Planning

Using read-only Solana RPC, the command fetches:

- PoolConfig
- MerkleTree
- PendingDepositsBuffer
- consumed message PDA
- commitment index PDA
- AssetVault account existence

It reports:

- target pending index
- current pending count
- whether FIFO prefix settlement is required
- number of commitments before target
- current Merkle root
- current `nextLeafIndex`
- whether the target appears already settled

If the target is pending at index `0`, readiness can be `ready`. If the target is pending behind earlier commitments, readiness is `blocked_fifo` and the operator must explicitly decide whether to run the mutating script with FIFO prefix settlement enabled.

## Wallet / Pool Authority Preflight

The command checks env presence by name only and prints only public metadata:

- `ANCHOR_WALLET`
- `SOLANA_POOL_AUTHORITY_KEYPAIR`
- `SOLANA_DEVNET_RPC_URL` or `RPC_ENDPOINT`
- `IDL_PATH`
- `PROGRAM_ID`
- `POOL_CONFIG`

It prints:

- wallet public key
- wallet SOL balance
- expected PoolConfig authority public key
- whether configured wallet matches PoolConfig authority

It does not print key material or env contents.

## Non-Secret Result Export

The command writes a non-secret JSON report to:

- `/data/bridge-results/preflight-<destinationHash>.json`

The report includes artifact status, zkey hashes, note-state validation booleans, FIFO plan, Merkle state, wallet public key/balance, pool authority match, readiness, and `transactionsSubmitted=false`.

## Tests Run

- `cd chains/solana && npm run bridge:test-preflight:settle-withdraw`: passed
- `cd relayer && npm run test`: passed, `25` suites / `354` tests
- `cd relayer && npm run typecheck`: passed
- `cd relayer && npm run build`: passed
- `cd relayer && npm run watcher:smoke`: passed
- `cd relayer && npm run watcher:report`: passed, `openFindings=0`
- `cd chains/solana && npm run test:rust`: passed, `115` tests
- `cd chains/solana && npm run build:sbf`: passed

## Remaining Limitations

- Render app image still lacks Rust/SBF tooling; Rust and SBF validation run in Codespace.
- The preflight command is read-only and does not replace operator approval for FIFO prefix settlement.
- The command validates the presence of zkeys and note-state, but durable backup lifecycle still depends on Render persistent disk retention.

## Next Recommended PR

PR-012H should wrap preflight and settlement/withdraw execution in an operator job that refuses to run mutating settlement unless the preflight report is fresh, ready or explicitly FIFO-approved, and referenced by hash.
