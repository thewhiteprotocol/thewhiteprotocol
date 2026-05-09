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

Default hosted watcher safety knobs:

- `BRIDGE_WATCHER_ENABLED=false`
- `BRIDGE_WATCHER_DRY_RUN=true`
- `BRIDGE_WATCHER_AUTO_FREEZE=false`
- `BRIDGE_ALERT_DRY_RUN=true`
- `BRIDGE_ALERT_MIN_SEVERITY=high`
- `BRIDGE_WATCHER_FINDING_RETENTION_DAYS=30`

## 11. Remaining Limitations

- Testnet only.
- `public_data_hash` is still weak/dummy-constrained in-circuit.
- Signer custody is still manual/testnet oriented.
- No production HSM/KMS/MPC signer custody.
- No live on-chain freeze transaction submission by default.
- Watcher daemon is operational scaffolding and must be exercised on testnet before any production claim.
- Solana -> EVM economic normalization needs a dedicated follow-up.
