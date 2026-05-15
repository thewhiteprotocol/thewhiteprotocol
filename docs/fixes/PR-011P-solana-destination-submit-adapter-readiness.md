# PR-011P — Solana Destination Submit Adapter Readiness

## Summary

PR-011P fixes the Solana destination submit preview for Base Sepolia -> Solana Devnet paper mode. The preview now uses the destination `BridgeMint` message hash, Solana signer set version `2`, and deployed Solana Devnet account inputs instead of placeholder accounts.

This PR does not submit a Solana transaction and does not enable live submit.

## PR-011O Blockers

PR-011O found these blockers:

- hosted preview used the source BridgeOut hash
- hosted preview used signer set version `1`
- hosted preview included placeholder `11111111111111111111111111111111` accounts
- pending buffer and commitment index were derived from placeholder inputs
- Solana destination submission remained preview-only

## Hash Handling Fix

The daemon now preserves both hashes:

- source BridgeOut hash: `sourceMessageHash`
- destination BridgeMint hash: `messageHash` / `destinationMessageHash`

For Base Sepolia -> Solana Devnet, the Solana submit preview uses the destination BridgeMint hash for:

- preview `messageHash`
- consumed-message PDA derivation
- frozen-message PDA derivation

The source BridgeOut hash remains visible separately for operator audit.

## Signer Set Version Fix

The Base Sepolia -> Solana Devnet route now uses deployed Solana signer set version `2` by default.

Expected signer set PDA:

- `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`

If a route is explicitly configured with a mismatched signer set version, the Solana readiness status blocks approval with `blocked_signer_set_mismatch`.

## Real Solana Account Config

The route now carries non-secret Solana destination account config:

- program: `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`
- BridgeV1Config: `5ZiC1A8NTS1pc1Rp1mQEnPERzJA1viJZYqW7MX9QhH9s`
- signer set v2: `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`
- route config: `Bp6dhddL1pRRacMYGfKqFyN6azEujbphzH8xmnpKzEWt`
- asset config: `CByfLtYcZcVWJoihhzTaKGeVEbqL9b9b1qgVdNLHEpdV`
- pool config: `DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF`
- Merkle tree: `7rNj4NVMyaNFSL9ius2hej2rpzk88d7spXrbYFchhnPi`
- pending buffer: `9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s`
- asset vault: `4Wb17Qbxm74i4BNLZ6CejXtaijLFRSre5wWKAzwWkaXD`

No placeholder system accounts are used in the Base -> Solana preview.

## PDA Derivation Review

For the PR-011N destination BridgeMint hash:

- destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`
- signer set v2 PDA: `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`
- consumed-message PDA: `FFms6Q7BHHPsVnWMEmL3gFiyZCu9pBMoog3Gfsp7Qodr`
- frozen-message PDA: `B5kc9gKjy4LpGYX8yAoAeHzL81eGAh3DGerL2KdeKpJe`
- pending buffer: `9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s`

The commitment-index PDA is derived from the destination commitment and deployed pool config.

## Read-Only Pre-Submit Checks

Added Solana read-only readiness checks for:

- program executable
- BridgeV1Config exists
- signer set exists
- route config exists
- asset config exists
- pending buffer exists
- pool config exists
- Merkle tree exists
- asset vault exists
- consumed-message PDA absent
- frozen-message PDA absent
- commitment-index PDA absent

RPC errors produce a blocked/unknown readiness state. The checker does not mutate Solana state.

## Submit Preview Readiness

The preview now includes:

- instruction name
- program ID
- account map
- account-meta preview
- signer set version
- signature count
- source message hash
- destination message hash
- destination commitment
- compute-budget recommendation
- readiness status

`liveSubmissionImplemented` remains `false` because this PR does not implement transaction submission. The corrected preview is ready for review, but live execution remains blocked until a later PR adds and tests the actual Solana transaction assembly/submission path.

## Tests Added

Added coverage for:

- destination BridgeMint hash in Solana preview
- source BridgeOut hash preserved separately
- signer set version `2` for Base -> Solana
- deployed Solana accounts in preview
- consumed/frozen PDAs from destination hash
- readiness blocking hash mismatch
- readiness blocking signer-set mismatch
- readiness blocking placeholder accounts
- read-only account-exists/absent checker
- no transaction submission in paper preview mode

## Commands Run

- `cd relayer && npm run test` — passed, 22 suites / 324 tests
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed
- `cd relayer && npm run watcher:smoke` — passed, 6 deterministic findings, 0 freeze submissions
- `cd relayer && npm run watcher:report` — passed, `liveFreezeTxCount=0`

## Remaining Limitations

- No Solana destination transaction is submitted in PR-011P.
- `liveSubmissionImplemented=false`.
- The preview is not a final signed transaction payload.
- The live submit path still needs idempotency checks immediately before submit.
- Mainnet remains unsupported.
- Not production-ready.

## Next Recommended PR

PR-011Q — Solana destination transaction assembly dry-run:

- build the full `accept_bridge_v1_mint` transaction locally
- attach compute budget instructions
- serialize but do not send
- verify account metas and instruction data against Anchor/IDL expectations
- keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
