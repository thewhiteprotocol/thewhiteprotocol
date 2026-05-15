# PR-011O — Paper Operator Approval Package: Base Sepolia -> Solana Devnet

## Summary

PR-011O reviews the fresh PR-011N Base Sepolia -> Solana Devnet paper-mode message before any live destination submission work.

The message is accepted for paper-mode observation only. It is not approved for live Solana submission because the current hosted Solana submit preview remains preview-only and still has live-submit blockers:

- `submitPreview.solana.liveSubmissionImplemented=false`
- hosted preview `messageHash` is the source BridgeOut hash, while the generated destination BridgeMint hash is different
- hosted preview `signerSetVersion=1`, while the source-generation evidence used Solana signer set version `2`
- hosted preview still includes placeholder accounts for `poolConfig`, `merkleTree`, and `assetVault`
- hosted preview derives `pendingBuffer` and `commitmentIndex` from placeholder inputs, not the deployed pool inputs

No destination transaction was submitted.

## PR-011N Evidence Reviewed

- Base deposit tx: `0xde7be4f0b274ac10441bacb9b95ebac2ccf737a168d96aa82b8a851d93cba06a`
- Base settlement tx: `0x5c59347a5d7ca7da4ab1d06d643d3c728d1b4f72eb12ae20c9483e897a0908c8`
- Base bridgeOutV1 tx: `0xf0f3f4f12ddbd2ade17334f72a4a348dce614b706ad6427077840dbf9cfef866`
- Source block: `41539671`
- Source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- Source nullifier hash: `0x06d4205f79ea409021fce0ee1b47c34c0701969c4990465e61300b08da970d01`
- Source nullifier spent: `true`
- Destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`

Generated local state files contain private note material and were not copied into this report. Only non-sensitive fields were reviewed.

## Persisted Daemon Message Review

Hosted read-only daemon APIs reported:

- mode: `paper`
- live submit enabled: `false`
- route: `base-sepolia -> solana-devnet`
- message status: `paper_ready_to_submit`
- daemon message hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- source tx: `0xf0f3f4f12ddbd2ade17334f72a4a348dce614b706ad6427077840dbf9cfef866`
- source block: `41539671`
- policy decision: accepted
- signing decision: accepted
- signatures: `2`
- `submitTxHash=null`
- `wouldSubmit=true` in paper preview only

The daemon message is persisted and inspectable through read-only hosted APIs. No authenticated mutation endpoint was called.

## Message And Normalization Review

The reviewed PR-011N source generation evidence records:

- source amount: `1000000000000000` wei
- source decimals: `18`
- destination decimals: `9`
- destination amount: `1000000` lamports
- normalization mode: `exact-decimal`
- manual message edit used: `false`

The conversion is exact: `1000000000000000 / 10^(18 - 9) = 1000000`.

The source BridgeOut hash matches the emitted source event. The destination BridgeMint hash was generated from the normalized destination message and is distinct from the source BridgeOut hash.

## Submit Preview Review

Hosted Solana submit preview:

- destination chain: `solana-devnet`
- program: `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`
- instruction: `accept_bridge_v1_mint`
- preview message hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- preview signer set version: `1`
- signature count: `2`
- route: `base-sepolia->solana-devnet`
- dry run: `true`
- live submission implemented: `false`

Review finding: the preview is adequate as a paper-mode observation artifact, but not as a live-submit package. A live Solana submit package must use the destination BridgeMint hash `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56` and the destination signer set/version intended for Solana acceptance.

## Signer Set Review

Hosted daemon status:

- signer adapter: `env-file`
- threshold: `2`
- route signer set version: `1`

PR-011N source-generation evidence:

- Solana signer set version: `2`
- signatures produced: `2`
- recovered signer addresses:
  - `0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820`
  - `0xbd7d34e42352BCe888394263A84CF21c85608beC`

Solana Devnet read-only account check found signer set version `2` at PDA `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`. The account data includes the expected 2-of-3 signer set members, including the two recovered signer addresses above.

Review finding: the signatures are enough for paper review, but live submit must reconcile the hosted route signer set version with the deployed destination signer set version before execution.

## Solana PDA And Account Review

Program:

- `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`
- read-only account check: exists, executable, owner `BPFLoaderUpgradeab1e11111111111111111111111`

Hosted preview accounts:

- BridgeV1Config: `5ZiC1A8NTS1pc1Rp1mQEnPERzJA1viJZYqW7MX9QhH9s`
- BridgeSignerSet: `EmzrmwDA9wGNxUuS7DLHygiMcHWVtAD1LnGwSBvHTVTZ`
- ConsumedBridgeMessage: `9Ckk2MMKybwZtfjfeY2pLCY7ppP8oHbCjXwgoZfBmo7i`
- FrozenBridgeMessage: `7GjkLMKj5Jy2JraywfBmtAiCti4kEaX72UTcSjyzJAiP`
- BridgeRouteConfig: `Bp6dhddL1pRRacMYGfKqFyN6azEujbphzH8xmnpKzEWt`
- BridgeAssetConfig: `CByfLtYcZcVWJoihhzTaKGeVEbqL9b9b1qgVdNLHEpdV`
- PendingDepositsBuffer: `5uokVoeUD5c7VAeTQNfzrybA61GEqYRvvLWcak68fnHD`
- CommitmentIndex: `3yk15zqqweMo7X6MhdyfMunpZ69mNeccU1h3h4S4dyWm`
- PoolConfig: `11111111111111111111111111111111`
- MerkleTree: `11111111111111111111111111111111`
- AssetVault: `11111111111111111111111111111111`

Read-only Solana Devnet account checks:

- BridgeV1Config exists and is owned by the program.
- Preview signer set PDA `EmzrmwDA9wGNxUuS7DLHygiMcHWVtAD1LnGwSBvHTVTZ` exists and is owned by the program.
- Deployed signer set version `2` PDA `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK` exists and is owned by the program.
- BridgeRouteConfig `Bp6dhddL1pRRacMYGfKqFyN6azEujbphzH8xmnpKzEWt` exists and is owned by the program.
- BridgeAssetConfig `CByfLtYcZcVWJoihhzTaKGeVEbqL9b9b1qgVdNLHEpdV` exists and is owned by the program.
- Preview PendingDepositsBuffer `5uokVoeUD5c7VAeTQNfzrybA61GEqYRvvLWcak68fnHD` was not found.
- Deployed PendingDepositsBuffer `9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s` exists and is owned by the program.
- Deployed PoolConfig `DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF` exists and is owned by the program.
- Deployed MerkleTree `7rNj4NVMyaNFSL9ius2hej2rpzk88d7spXrbYFchhnPi` exists and is owned by the program.
- Deployed AssetVault `4Wb17Qbxm74i4BNLZ6CejXtaijLFRSre5wWKAzwWkaXD` exists and is owned by the program.

Destination-hash PDA derivation using the deployed pool inputs:

- destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`
- signer set version `2`: `7Emf7vYUY9mpkzBfnzWKJ4B9PNqqrMzr5wyuUc8ap4XK`
- consumed message: `FFms6Q7BHHPsVnWMEmL3gFiyZCu9pBMoog3Gfsp7Qodr`
- frozen message: `B5kc9gKjy4LpGYX8yAoAeHzL81eGAh3DGerL2KdeKpJe`
- pending buffer: `9oEKYL8iD7mBdvPzrgtv8Q15QqAWUL9ycSGAkt5QT42s`
- commitment index: `EyZbhYhv2BRgJ3vaiyDgWHri3r2SVJRNa5qUnUcugwf3`

Read-only checks found the destination-hash consumed-message and frozen-message PDAs absent, which is the expected pre-submit state. The destination-hash commitment-index PDA is also absent, which is expected before a destination commitment is inserted.

## Solana Devnet State Review

Read-only review found:

- program exists
- BridgeV1Config exists
- signer set version `2` exists
- Base -> Solana route config exists
- canonical asset config exists
- deployed pending buffer exists
- destination message is not already consumed
- destination message is not frozen
- deployed pool, Merkle tree, and asset vault accounts exist

The raw account bytes were not copied into docs beyond public account identifiers and existence/owner results.

## Operator API Review

Verified read-only hosted endpoints:

- `GET /bridge/daemon/status`
- `GET /bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`

Observed:

- mode: `paper`
- live submit enabled: `false`
- message status: `paper_ready_to_submit`
- signatures: `2`
- preview visible
- `submitTxHash=null`

No operator token, private key, RPC URL with key, webhook URL, note secret, witness, or wallet file was printed.

## Operator Approval Checklist

Created:

- `docs/runbooks/bridge-operator-approval-checklist.md`

PR-011O checklist decision for this exact message:

- paper observation reviewed: pass
- live destination submission approval: hold
- reason: Solana live submit adapter is not implemented, and preview account/hash/version inputs need reconciliation before approval

## Future Live-Submit Requirements

Future live-testnet destination submission must not proceed until all of the following are true:

- `BRIDGE_DAEMON_MODE=live-testnet`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`
- route allowlist includes only `base-sepolia:solana-devnet` for the approved window
- no open critical watcher findings
- signer adapter is allowed in the target environment
- Solana live submission implementation exists
- submit package uses destination BridgeMint hash `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`
- signer set version matches the deployed destination signer set intended for submission
- PoolConfig, MerkleTree, AssetVault, PendingDepositsBuffer, and CommitmentIndex inputs are real deployed accounts, not placeholders
- compute budget and rent requirements are handled
- operator approval is recorded for the exact message hash selected
- consumed-message and frozen-message idempotency checks run immediately before submit

Live submit cannot proceed from PR-011O because `submitPreview.solana.liveSubmissionImplemented=false`.

## Commands Run

- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status`
- `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- `solana account <public account> --url https://api.devnet.solana.com`
- non-secret local state extraction from `chains/evm/test/base-to-solana-bridge-state.json`

## Tests Run

No code was changed for PR-011O. Relayer regression commands were still run:

- `cd relayer && npm run test` — passed, 22 suites / 320 tests
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed

## Remaining Limitations

- Solana destination submission remains preview-only.
- Hosted preview uses the source BridgeOut hash, not the destination BridgeMint hash.
- Hosted route preview reports signer set version `1`; PR-011N destination evidence uses Solana signer set version `2`.
- Hosted preview includes placeholder account inputs for live Solana submission.
- Authenticated hosted mutation endpoints were not called.
- Generated local state files contain sensitive note material and must remain uncommitted.
- Live-testnet destination submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011P — Solana destination live-submit adapter readiness:

- reconcile destination BridgeMint hash handling in daemon preview/signing
- pass route signer set version into Solana account derivation
- wire deployed PoolConfig, MerkleTree, AssetVault, PendingDepositsBuffer, and CommitmentIndex inputs
- add pre-submit consumed/frozen/idempotency checks
- keep live submit disabled until a follow-up approval window
