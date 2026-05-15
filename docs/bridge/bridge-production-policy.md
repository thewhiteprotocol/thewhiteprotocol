# Bridge Production Relayer Policy

**Date:** 2026-05-09
**Status:** Testnet policy hardening; not mainnet-ready

## 1. Summary

Production relayers must only sign source-bound bridge messages. A syntactically valid `BridgeMessageV1` is not enough.

The relayer policy in `relayer/src/bridge/policy.ts` is deterministic and RPC-free. Chain adapters supply source observations; policy decides whether the relayer is allowed to sign.

## 2. Accepted Source Events

Accepted EVM source events:

- `evm_bridge_out_v1`
- `evm_bridge_outbox_bridge_out_initiated`

These represent the authorized EVM `WhiteProtocol.bridgeOutV1` / configured BridgeOutbox path. Relayers must verify that the event address matches the configured BridgeOutbox address when that address is configured.

Accepted Solana source events:

- `solana_bridge_out_v1_with_proof`

This represents the PR-010Y source-bound Solana path. It verifies the withdraw proof, spends the source nullifier, locks source-side value, creates the outbound replay PDA, and emits BridgeOut only after those checks pass.

## 3. Rejected Source Events

Rejected EVM events:

- `evm_bridge_outbox_direct`
- `unknown`
- any event from an unexpected BridgeOutbox address when address policy is configured

Rejected Solana events:

- `solana_init_bridge_v1_out`
- `unknown`
- any event from an unexpected Solana program ID

`init_bridge_v1_out` remains callable for message-level/test-only flows, but production relayers must ignore it. It does not verify a withdraw proof, spend a nullifier, bind `public_data_hash`, or lock source-side value.

## 4. Message Validation

Before signing, relayers recompute and validate:

- `hashBridgeMessageV1(message)` equals the observed message hash.
- `message.messageType == BridgeOut`.
- source domain matches the configured source chain.
- destination domain matches the configured destination chain.
- source and destination chain IDs match configured route policy.
- event amount, nonce, destination domain, and canonical asset match the encoded message.
- deadline is not expired.
- relayer state does not already contain the message hash.
- destination has not already consumed the message hash when that observation is available.

## 5. Route and Asset Policy

Routes are configured with:

- source chain key
- destination chain key
- enabled flag
- signer set version
- route status: `live`, `test-only`, `disabled`, or `manual-review`
- supported canonical asset IDs
- source and destination decimals
- amount normalization mode
- per-message and daily caps

Unsupported routes and unsupported assets are rejected.

Disabled routes are rejected. Manual-review routes are not signed on the fast path.

## 6. Amount and Cap Policy

For same-decimal routes, caps are enforced directly on the source `BridgeOut.amount`.

For cross-decimal routes, source messages are first checked for supported asset and route. Destination-local caps are enforced after exact-decimal normalization.

The policy supports:

- `maxMessageAmount`
- `dailyCap`
- `maxFastPathAmount`
- `manualReviewAmount`
- `capAmountUnits = source | destination`

## 7. Cross-Decimal Policy

Exact-decimal normalization is required for current Solana/EVM testnet routes.

For Base -> Solana, source wei are converted to Solana local units only if the source amount is divisible by `10^(18 - 9)`. Non-divisible amounts are rejected.

For Solana -> Base, the economic policy remains a follow-up item. PR-010Z proved the security path with equal numeric source/destination units, not final production economics.

## 8. Finality Policy

Default testnet finality rules:

| Chain | Rule |
| --- | ---: |
| Base Sepolia | 3 confirmations |
| Ethereum Sepolia | 12 confirmations |
| BNB Chain Testnet | 15 confirmations |
| Polygon Amoy | 64 confirmations |
| Solana Devnet | 32 confirmations / finalized-source policy |

Policy can also accept adapter-provided confirmation counts. If source finality is not met, the relayer delays rather than signs.

Mainnet policy must use chain-specific finality, reorg, and L2 derivation checks before any production claim.

## 9. Replay Policy

Relayers must not sign when:

- local relayer state already has the source/destination message hash.
- destination consumed state is already true.
- source event came from an unsafe message-level path.

On-chain replay protection remains authoritative:

- EVM destination uses `BridgeInbox.isMessageConsumed`.
- Solana destination uses `ConsumedBridgeMessage`.
- Solana source uses `OutboundBridgeMessage` and `SpentNullifier`.

## 10. Watcher Interaction

`relayer/src/bridge/watcher.ts` consumes policy decisions and turns them into findings:

- `ignore`
- `delay`
- `alert`
- `manual_review`
- `freeze`

`relayer/src/bridge/watcher-daemon.ts` can run those checks on an interval when explicitly enabled. The daemon is disabled by default and dry-run by default. Findings are persisted in `bridge-watcher-findings.json` by default, or in `BRIDGE_WATCHER_FINDINGS_PATH` when configured.

Operator APIs are mounted under `/bridge/watcher/*` when the bridge status API is configured. They require `BRIDGE_OPERATOR_API_TOKEN`; unauthenticated mutation is rejected.

PR-011B builds EVM calldata and Solana instruction previews for freeze recommendations, but it does not submit live freeze transactions by default.

PR-011C adds hosted dry-run alerting hooks. `BRIDGE_ALERT_WEBHOOK_URL` is optional, `BRIDGE_ALERT_DRY_RUN=true` by default, and status responses only expose alerting mode/threshold, never the webhook URL.

PR-011D adds `npm run watcher:smoke` and deterministic synthetic findings so operators can validate watcher persistence, status shape, alert no-op/failure behavior, and freeze previews without live RPC or freeze submission. The hosted dry-run process is documented in `docs/runbooks/bridge-watcher-dry-run.md`.

PR-011E adds `npm run watcher:report`, observation-window summaries, and an explicit escalation policy for hosted testnet dry-run. The report is generated from persisted watcher findings and must show `liveFreezeTxCount=0` while `BRIDGE_WATCHER_DRY_RUN=true`.

PR-011F adds the signer custody adapter interface and a signing policy gate. Bridge attestations must pass bridge policy, finality, route, asset, amount, watcher-critical-finding, dry-run, adapter-mode, purpose, and `BridgeMessageV1` format checks before signing. `local-dev` and raw `env-file` signing are blocked in production by default.

PR-011G adds daemonized bridge relayer mode in `relayer/src/bridge/daemon.ts`. The daemon is `disabled` by default. In `paper` mode it observes source events, applies policy, waits finality, builds destination messages, consults watcher findings, runs signer policy, optionally signs, and records EVM/Solana submit previews without submitting destination transactions. In `live-testnet` mode, destination submission is allowed only when `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=true`, every route is a known testnet route, no open critical watcher finding exists, signer mode is permitted, and a destination adapter is configured. Mainnet and unknown routes are blocked.

Default hosted watcher safety knobs:

- `BRIDGE_WATCHER_ENABLED=false`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_ALERT_DRY_RUN=true`
- `BRIDGE_ALERT_MIN_SEVERITY=high`
- `BRIDGE_WATCHER_FINDING_RETENTION_DAYS=30`

Observation window defaults:

- `BRIDGE_WATCHER_OBSERVATION_WINDOW_HOURS=24`
- `BRIDGE_WATCHER_OBSERVATION_LABEL=hosted-testnet-dry-run`
- `BRIDGE_WATCHER_OBSERVATION_REPORT_PATH=<STATE_DIR>/bridge-watcher-observation-report.json`

Escalation policy:

- low: log only
- medium: alert if repeated
- high: alert immediately and require manual review
- critical: alert immediately, generate freeze preview, require operator review
- critical repeated: freeze recommended, but live execution remains blocked unless a later PR explicitly enables it

Signer custody defaults:

- `BRIDGE_SIGNER_MODE=local-dev` is local/test only.
- `BRIDGE_SIGNER_MODE=env-file` is testnet raw-key mode only.
- `BRIDGE_ALLOW_ENV_SIGNER_IN_PRODUCTION=false`.
- `kms`, `hsm`, and `mpc` modes are placeholders until custody integration.

Bridge daemon defaults:

- `BRIDGE_DAEMON_MODE=disabled`
- `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false`
- `BRIDGE_ALLOW_LOCAL_DEV_SIGNER_IN_LIVE_TESTNET=false`
- `BRIDGE_DAEMON_INTERVAL_MS=30000`
- mutation APIs under `/bridge/daemon/*` require `BRIDGE_OPERATOR_API_TOKEN`

PR-011H adds paper-mode historical replay commands:

- `npm run bridge:daemon:paper:once`
- `npm run bridge:daemon:paper:status`

These commands are for testnet paper validation only. They must keep `BRIDGE_ALLOW_LIVE_TESTNET_SUBMIT=false` and must not be used as proof of mainnet readiness.

PR-011I adds hosted paper-mode preparation for fresh live testnet logs:

- `npm run bridge:daemon:env:check` prints required env var names only.
- `npm run bridge:daemon:paper:scan` scans Base Sepolia BridgeOut logs when hosted RPC/signer/operator env is configured.
- live confirmations are carried into source policy as `event.confirmations`.
- no destination submit adapter is called in paper mode.
- if hosted env is missing, the scan reports missing names and exits without scanning or submitting.

PR-011J reruns the hosted paper-mode path with the real-env commands. In the local shell used for the PR, the run remained safely blocked because the hosted RPC, signer, operator token, daemon route, daemon mode, and state-path env names were absent. The scanner exited before RPC access and reported `destinationTxSubmitted=false`. A historical paper fallback was run only to confirm the persisted paper-state path still produces signatures and Solana previews without submission.

PR-011K repeats the hosted paper scan readiness gate for the real-secrets environment. The env check still failed in this shell, so the live scan was not run. This is the required safety behavior: missing hosted env names must block RPC scanning and destination submission.

## 11. Remaining Limitations

- Testnet only.
- `public_data_hash` is still weak/dummy-constrained in-circuit.
- Signer custody is still manual/testnet oriented.
- No production HSM/KMS/MPC signer custody.
- No live on-chain freeze transaction submission by default.
- Watcher daemon is operational scaffolding and must be exercised on testnet before any production claim.
- Solana -> EVM economic normalization needs a dedicated follow-up.
