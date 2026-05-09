# PR-011A - Bridge Watcher Policy Hardening

**Date:** 2026-05-09
**Status:** Complete for offline policy and watcher foundations

## 1. Summary

PR-011A hardens the bridge relayer signing policy and adds watcher/challenge/freeze scaffolding.

No contracts, Solana programs, circuits, deployment artifacts, live routes, or runtime deployments were changed.

## 2. Relayer Event Handling Audit

Before PR-011A, the relayer decoded BridgeOut events and processed them through route and signer logic, but it did not have a centralized production policy module that could distinguish every safe source-bound event from unsafe message-level events.

Key audit results:

- EVM adapter watches configured BridgeOutbox `BridgeOutInitiated` logs.
- Solana adapter was destination/PDA scaffolding and did not provide source event filtering.
- Route and asset metadata existed for Base -> Solana normalization.
- Relayer state persisted message hashes and status transitions.
- Finality existed in service flow but was not exposed as a reusable policy decision.
- There was no watcher module producing freeze/manual-review recommendations.

## 3. Policy Module

Added:

- `relayer/src/bridge/policy.ts`

The policy module exposes deterministic checks for:

- production source event kind
- source and destination chain/domain matching
- BridgeMessageV1 validation
- message hash recomputation
- event/message field consistency
- route support
- asset support
- amount caps
- deadline validity
- source finality
- relayer/destination replay observations
- cross-decimal normalization checks

## 4. Source Event Policy

Accepted:

- EVM `evm_bridge_out_v1`
- EVM `evm_bridge_outbox_bridge_out_initiated`
- Solana `solana_bridge_out_v1_with_proof`

Rejected or ignored:

- Solana `solana_init_bridge_v1_out`
- EVM `evm_bridge_outbox_direct`
- `unknown`
- wrong configured source address/program ID

Production relayers must ignore Solana `init_bridge_v1_out`; it remains message-level/test-only.

## 5. Finality Rules

Default testnet finality config is now explicit:

- Base Sepolia: 3 confirmations
- Ethereum Sepolia: 12 confirmations
- BNB Chain Testnet: 15 confirmations
- Polygon Amoy: 64 confirmations
- Solana Devnet: 32 confirmations / finalized source policy

The policy returns `delay` for not-final observations rather than allowing signing.

## 6. Route and Asset Policy

Routes now support:

- operational status: `live`, `test-only`, `disabled`, `manual-review`
- fast-path threshold
- manual-review threshold
- per-asset cap units: source or destination

Unsupported routes/assets are rejected. Disabled routes are rejected. Manual-review routes do not sign on fast path.

## 7. Cross-Decimal Policy

The policy validates exact-decimal normalization and rejects mismatched destination amounts.

For Base -> Solana, destination-local caps are enforced after converting source wei to Solana-local units.

Solana -> EVM economic normalization remains a follow-up item. PR-010Z proved the security path, not final production economics.

## 8. Watcher Module

Added:

- `relayer/src/bridge/watcher.ts`

The watcher produces findings with:

- code
- message
- severity
- recommended action

Recommended actions:

- `accept`
- `delay`
- `alert`
- `manual_review`
- `freeze`
- `ignore`

PR-011A does not submit on-chain freeze transactions. It produces policy decisions and recommendations for a future daemon/operator loop.

## 9. Adapter Updates

EVM source observations now include:

- `sourceEventKind = evm_bridge_outbox_bridge_out_initiated`
- emitting BridgeOutbox address
- source transaction success marker

Solana adapter metadata was updated to the current devnet program ID and PR-010Y PDA seed names:

- Program ID: `DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD`
- consumed seed: `bridge_consumed`
- frozen seed: `bridge_frozen`
- outbound seed: `bridge_outbound`

The Solana accept-mint PDA helper now derives consumed/frozen message PDAs from `hashBridgeMessageV1(message)`.

## 10. Tests Added

Added:

- `relayer/src/bridge/__tests__/policy.test.ts`

Coverage:

- EVM source-bound event accepted
- EVM unsafe/direct event rejected
- Solana `bridge_out_v1_with_proof` event accepted
- Solana `init_bridge_v1_out` event rejected
- wrong source domain rejected
- wrong destination domain rejected
- unsupported asset rejected
- amount over cap rejected
- expired deadline rejected
- not-final source event delayed
- duplicate message hash rejected
- cross-decimal mismatch rejected
- valid Base -> Solana policy path accepted
- valid Solana -> Base policy path accepted
- watcher recommends freeze for unsafe source event
- watcher recommends manual review for high-value message
- watcher recommends freeze for cross-decimal mismatch
- watcher env config parsing

Existing relayer service tests were updated so source events use `BridgeOut`, matching production source policy.

## 11. Commands Run

```text
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
```

Results:

- Relayer tests: 17 suites passed, 231 tests passed
- Typecheck: passed
- Build: passed

## 12. Security Limitations

- Testnet only.
- `public_data_hash` remains weak/dummy-constrained in-circuit.
- No on-chain freeze transaction daemon in PR-011A.
- No production signer custody.
- No automated liquidity/risk monitoring daemon yet.
- Solana -> EVM amount normalization requires a dedicated follow-up policy PR.
- `init_bridge_v1_out` remains callable but is production-policy ignored.

## 13. Next Recommended PR

PR-011B - daemonize watcher/challenge/freeze operations, persist findings, expose operator APIs, and optionally submit chain-specific freeze transactions after policy approval.
