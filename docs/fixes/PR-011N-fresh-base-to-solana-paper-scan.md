# PR-011N — Fresh Base Sepolia -> Solana Devnet Paper Scan

## Summary

PR-011N generated one approved low-value Base Sepolia -> Solana Devnet source `BridgeOut` event using the production source path, then verified hosted paper mode observed it and reached `paper_ready_to_submit`.

The hosted daemon found the fresh event, parsed the `BridgeMessageV1`, accepted policy, produced 2 signatures, created a Solana `accept_bridge_v1_mint` submit preview, persisted state, and exposed the message through read-only daemon APIs.

No destination transaction was submitted.

## Why PR-011N Was Needed After PR-011M

PR-011M proved known-range live RPC scanning against the PR-010W event, but the historical message was rejected by current-time policy with `expired_deadline`.

PR-011N was needed to exercise the full current-time paper path with a fresh future-deadline source event.

## Source Event Generation Details

Source script:

```bash
cd chains/evm
npx tsx test/e2e-bridge-base-to-solana.ts
```

The script:

- deposits on Base Sepolia
- settles the source commitment into the Base Merkle tree
- builds a Base -> Solana `BridgeMessageV1`
- generates the Base withdraw proof
- calls `WhiteProtocol.bridgeOutV1`
- verifies the source nullifier is spent
- saves local state for the Solana side
- does not submit a Solana destination transaction

Amount normalization:

- mode: `exact-decimal`
- source decimals: `18`
- destination decimals: `9`
- source amount: `1000000000000000` wei
- destination amount: `1000000` lamports

## Base Deposit Evidence

- deposit tx: `0xde7be4f0b274ac10441bacb9b95ebac2ccf737a168d96aa82b8a851d93cba06a`

## Base Settlement Evidence

- settlement tx: `0x5c59347a5d7ca7da4ab1d06d643d3c728d1b4f72eb12ae20c9483e897a0908c8`
- leaf index: `31`
- settlement block: `41539664`

## Base bridgeOutV1 Evidence

- bridgeOutV1 tx: `0xf0f3f4f12ddbd2ade17334f72a4a348dce614b706ad6427077840dbf9cfef866`
- source block: `41539671`
- gas used: `562307`
- finality confirmations observed by source script: `2`

## Source Event Block / Hash / Deadline

- source block: `41539671`
- source BridgeOut hash: `0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
- source nullifier hash: `0x06d4205f79ea409021fce0ee1b47c34c0701969c4990465e61300b08da970d01`
- source nullifier spent: `true`
- destination BridgeMint hash: `0xcd745c98e78eed6667f9655efa2f4725d052a9c06c4419c1c2dd8a05727f8f56`

## Hosted Scan Range

Hosted daemon mode used its configured 1000-block lookback. The event was fresh and in-range.

Hosted daemon status after scan:

- mode: `paper`
- running: `true`
- route: `base-sepolia -> solana-devnet`
- live submit enabled: `false`
- messages by status: `paper_ready_to_submit: 1`

## Policy Result

Hosted message policy:

- accepted: `true`
- action: `accept`
- severity: `info`
- reasons: `[]`

## Finality Result

The source event had already reached the daemon's configured finality threshold by the time hosted paper mode processed it. The hosted message reached `paper_ready_to_submit`.

## Watcher Result

No watcher block was present for the fresh message.

Watcher report remained safe:

- dryRun: `true`
- autoFreeze: `false`
- liveFreezeTxCount: `0`

## Signing Result

Hosted signing result:

- signer adapter: `env-file`
- threshold: `2`
- signatures produced: `2`
- signing decision accepted: `true`

## Submit Preview Result

Hosted paper mode created a Solana submit preview:

- destination chain: `solana-devnet`
- method: `accept_bridge_v1_mint`
- program: `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`
- signature count: `2`
- dryRun: `true`
- wouldSubmit: `true`
- liveSubmissionImplemented: `false`

## Proof No Destination Tx Submitted

Evidence:

- daemon mode: `paper`
- live submit enabled: `false`
- message status: `paper_ready_to_submit`
- `submitTxHash=null`
- `/bridge/status` submitted counter: `0`
- watcher report `liveFreezeTxCount=0`

## Operator API Result

Read-only hosted endpoints verified:

- `GET /bridge/daemon/status`
- `GET /bridge/daemon/messages`
- `GET /bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`

Hosted watcher status is auth-gated and returned `401` without an operator token, as expected.

No authenticated mutation endpoint was called in this transcript.

## Commands Run

- Base source event generation:
  - `cd chains/evm && ... npx tsx test/e2e-bridge-base-to-solana.ts`
- Hosted daemon API checks:
  - `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/status`
  - `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages`
  - `curl -fsS https://relayer.thewhiteprotocol.com/bridge/daemon/messages/0x78db644c282399fb04d304752cd492ca12e31982e50e78bb382eb836905384bc`
  - `curl -fsS https://relayer.thewhiteprotocol.com/bridge/status`
  - `curl -fsS https://relayer.thewhiteprotocol.com/bridge/watcher/status`

## Tests Run

- `cd relayer && npm run test` — passed, 22 suites / 320 tests
- `cd relayer && npm run typecheck` — passed
- `cd relayer && npm run build` — passed
- `cd relayer && npm run watcher:smoke` — passed, 6 deterministic findings, 0 freeze submissions
- `cd relayer && STATE_DIR=/tmp/white-bridge-watcher-smoke-Bh20uD npm run watcher:report` — passed, `liveFreezeTxCount=0`

## Remaining Limitations

- Solana destination submission remains preview-only.
- `submitPreview.solana.liveSubmissionImplemented=false`.
- Hosted authenticated mutation endpoints were not called because the operator token was not used in this transcript.
- Generated local state files contain sensitive note material and must remain uncommitted.
- Live-testnet destination submission remains disabled.
- Not production-ready.

## Next Recommended PR

PR-011O — paper-mode operator approval package for the fresh message:

- review the persisted daemon message and Solana preview accounts
- verify signer set version and PDA derivations against deployed Solana Devnet state
- document an operator approval checklist for a future live-testnet destination submit PR
- keep live submit disabled until explicit approval
