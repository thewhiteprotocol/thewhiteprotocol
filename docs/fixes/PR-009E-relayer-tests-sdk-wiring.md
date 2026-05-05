# PR-009E — Relayer Test Coverage, SDK Wiring Audit, and Idempotency Tests

**Date:** 2026-05-04  
**Status:** ✅ COMPLETE  
**Branch/Commit:** Relayer test foundation (`a588257` base + additions)

---

## 1. Summary

PR-009E established a comprehensive unit-test foundation for the relayer, installed and configured the Jest test runner, and completed an SDK wiring audit. The audit concluded that `@whiteprotocol/sdk` **must not** be wired to the relayer at this time because the SDK's PDA seeds target a future program revision incompatible with the currently deployed devnet program.

All missing test areas identified during the acceptance review were implemented. The relayer now has **99 passing unit tests** across **8 test suites** with **zero live RPC dependencies**.

---

## 2. Why SDK Was Not Wired

The relayer's internal `solana-pdas.ts` was audited against `@whiteprotocol/sdk` (`chains/solana/sdk`). The SDK's seeds do **not** match the deployed devnet program. Wiring the SDK would cause incorrect PDA derivation, leading to:
- Failed pool configuration lookups
- Failed Merkle tree synchronisation
- Failed token vault operations
- Failed nullifier tracking (potential double-spend risk)
- Failed batch settlement

The SDK is also explicitly marked as alpha / not production-ready (`IS_PRODUCTION_READY = false`).

Full audit: [`relayer/SDK-WIRING-AUDIT.md`](../../relayer/SDK-WIRING-AUDIT.md)

---

## 3. PDA Seed Mismatch Table

| Account | SDK Seed | On-Chain Seed (deployed) | Impact |
|---------|----------|--------------------------|--------|
| `PoolConfig` | `pool_v2` | `white_pool` | All operations fail |
| `MerkleTree` | `merkle_tree_v2` | `merkle_tree` | Root mismatch |
| `AssetVault` | `vault_v2` | `vault` | Token transfers fail |
| `SpentNullifier` | `nullifier_v2` | `nullifier` | Double-spend risk |
| `PendingDepositsBuffer` | `pending_deposits` | `pending` | Batch settlement fails |
| `VerificationKey` | `vk_v2` + type seed | `vk_{type}` directly | Wrong VK accounts |

---

## 4. ProofType MerkleBatchUpdate Gap

The on-chain program defines `ProofType::MerkleBatchUpdate = 4`, but the SDK enum omits it entirely:

```rust
// On-chain (lib.rs)
pub enum ProofType {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3,
    MerkleBatchUpdate = 4,  // ← MISSING FROM SDK
    WithdrawV2 = 5,
}
```

```typescript
// SDK (types.d.ts)
export declare enum ProofType {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3,
    WithdrawV2 = 5
}
```

This means the relayer's `vk_merkle_batch` PDA has **no SDK equivalent**.

**Decision:** Keep internal `findMerkleBatchVkPda` helper. Re-audit SDK compatibility after the on-chain program is upgraded and the SDK adds the missing variant.

---

## 5. Test Runner Used

- **Framework:** Jest (installed in PR-009E)
- **TypeScript integration:** ts-jest
- **Config:** `relayer/jest.config.js`
- **Test pattern:** `src/__tests__/**/*.test.ts`
- **Global types:** `"jest"` added to `relayer/tsconfig.json` `types` array

---

## 6. Test Files Added/Updated

| File | Tests | Description |
|------|-------|-------------|
| `src/__tests__/solana-pdas.test.ts` | 13 | Solana PDA derivation determinism and correctness |
| `src/__tests__/solana-fee-validator.test.ts` | 12 | On-chain fee bound validation, active status, env overrides |
| `src/__tests__/config.test.ts` | 8 | RPC URL resolution, deployer key resolution, config validation |
| `src/__tests__/evm-sequencer.test.ts` | 7 | In-flight settlement tracking, timeout, restart persistence |
| `src/__tests__/evm-stealth.test.ts` | 13 | 33-byte compressed secp256k1 pubkey validation |
| `src/__tests__/retry.test.ts` | 7 | Retry logic, non-retryable pattern matching, error wrapping |
| `src/__tests__/circuit-breaker.test.ts` | 10 | CLOSED → OPEN → HALF_OPEN → CLOSED state transitions |
| `src/__tests__/state-store.test.ts` | 29 | JSON file persistence, atomic writes, per-chain isolation, error handling |

**Total: 99 tests across 8 suites.**

---

## 7. Test Coverage Matrix

| Requirement | Status | File(s) | Notes |
|-------------|--------|---------|-------|
| Relayer test runner | ✅ Complete | `jest.config.js`, `package.json`, `tsconfig.json` | Jest + ts-jest installed |
| Solana PDA helper tests | ✅ Complete | `solana-pdas.test.ts` | All 11 helpers covered |
| Solana fee validator tests | ✅ Complete | `solana-fee-validator.test.ts` | Bounds, active, env overrides |
| Config validation tests | ✅ Complete | `config.test.ts` | RPC, keys, secrets redaction |
| EVM in-flight/idempotency tests | ✅ Complete | `evm-sequencer.test.ts` | Double-submit prevention, timeout |
| Stealth 33-byte routing tests | ✅ Complete | `evm-stealth.test.ts` | Prefix, length, case, empty |
| Retry / CircuitBreaker tests | ✅ Complete | `retry.test.ts`, `circuit-breaker.test.ts` | Added in final pass |
| State-store persistence tests | ✅ Complete | `state-store.test.ts` | Added in final pass |
| SDK wiring audit | ✅ Complete | `SDK-WIRING-AUDIT.md` | Decision: do not wire |
| ProofType MerkleBatchUpdate decision | ✅ Complete | `SDK-WIRING-AUDIT.md` §4 | Documented gap |
| Typecheck passing | ✅ Complete | — | `tsc --noEmit` |
| Build passing | ✅ Complete | — | `npm run build` |

---

## 8. Solana PDA Helper Tests

Tests verify:
- Deterministic output for identical inputs
- Different outputs for different inputs (pool config, asset ID, operator)
- Correct bump seed range (`0–255`)
- Cross-helper determinism sanity check

Covered helpers: `findMerkleTreePda`, `findAssetVaultPda`, `findVaultTokenAccountPda`, `findSpentNullifierPda`, `findRelayerRegistryPda`, `findRelayerNodePda`, `findYieldRegistryPda`, `findPendingBufferPda`, `findWithdrawVkPda`, `findWithdrawV2VkPda`, `findMerkleBatchVkPda`

---

## 9. Solana Fee Validator Tests

Tests verify:
- `fetchRelayerRegistry` parses account data correctly
- `fetchRelayerNode` parses node info (isActive, feeBps, operator)
- Fee within bounds → pass
- Fee below minimum → fail
- Fee above maximum → fail
- Inactive node → fail
- Fee mismatch → fail
- Missing registry in production → fail closed
- Missing registry in dev without override → fail
- Missing registry in dev with override → pass
- Malformed registry data → graceful error handling

---

## 10. Config Validation Tests

Tests verify:
- Canonical env var resolution (`BASE_SEPOLIA_RPC_URL`)
- Deprecated alias fallback with console warning
- Missing RPC URL throws
- Per-chain deployer key resolution
- Fallback to `EVM_DEPLOYER_PRIVATE_KEY`
- `loadNetwork` returns correct chain metadata
- `validateConfig` reports missing RPC URLs for all live chains
- Secret values are **never** printed in error/warning messages
- Missing deployer keys produce warnings (not errors)

---

## 11. EVM In-Flight/Idempotency Tests

Tests verify:
- First tick submits settlement and records in-flight state
- Second tick while in-flight **does not** submit again (idempotency)
- In-flight cleared when `nextLeafIndex` advances on-chain
- In-flight timeout expires after 120 seconds, allowing retry
- Root mismatch skips tick instead of blind submission
- Restart loads persisted in-flight state if within timeout
- Restart discards stale in-flight state beyond timeout

All tests use mocked `EvmAdapter` and mocked `ServerMerkleTree` (no Poseidon init required).

---

## 12. Stealth 33-Byte Routing Tests

Tests verify `isValidCompressedSecp256k1Pubkey`:
- Accepts 66-char hex starting with `0x02`
- Accepts 66-char hex starting with `0x03`
- Accepts mixed case
- Rejects 64-char hex (32 bytes)
- Rejects 68-char hex (34 bytes)
- Rejects prefix `0x04`
- Rejects prefix `0x00`
- Rejects all zeros
- Rejects non-hex characters
- Rejects empty string

Tests verify `shouldUseEvmStealthWithdrawal`:
- Returns `false` when no ephemeral pubkey
- Returns `false` for invalid pubkey
- Returns `true` for valid `0x02` / `0x03` pubkeys

---

## 13. Retry / CircuitBreaker / State-Store Tests

### Retry (`retry.test.ts`)
- Returns immediately on success
- Retries on transient failure and eventually succeeds
- Throws after exhausting attempts
- Skips retry for non-retryable patterns (`insufficient funds`)
- Case-insensitive pattern matching
- Handles non-Error throws by wrapping in Error

### CircuitBreaker (`circuit-breaker.test.ts`)
- Starts in CLOSED state
- Increments failure count on error
- Opens after failure threshold reached
- Rejects immediately when OPEN
- Transitions to HALF_OPEN after timeout
- Resets to CLOSED after `successThreshold` successes in HALF_OPEN
- Re-opens immediately on failure in HALF_OPEN
- Resets failure count after success in CLOSED
- Respects custom `timeoutMs`

### State-Store (`state-store.test.ts`)
- Saves and loads relayer state, merkle tree state, pending state
- Saves and loads settled commitments
- Appends commitments (Solana, Base legacy, per-chain EVM)
- Per-chain EVM state isolation (`base-sepolia` vs `ethereum-sepolia`)
- In-flight pending state round-trip
- Atomic write semantics (temp file + rename, no `.tmp` residue)
- Graceful handling of corrupted JSON files (returns null)

---

## 14. Commands Run

```bash
# Typecheck
cd relayer && npm run typecheck

# Build
cd relayer && npm run build

# Run all unit tests
cd relayer && npx jest --testPathPatterns='__tests__'

# Run with verbose output
cd relayer && npx jest --testPathPatterns='__tests__' --verbose
```

---

## 15. Test / Typecheck / Build Results

```
Test Suites: 8 passed, 8 total
Tests:       99 passed, 99 total
Snapshots:   0 total

> npm run typecheck
> tsc --noEmit
  (no output = success)

> npm run build
> tsc && cp -r src/idl dist/
  (success)
```

---

## 16. Remaining Blockers

| Blocker | Severity | Notes |
|---------|----------|-------|
| SDK PDA seed mismatch | High | Blocks SDK wiring until on-chain program upgraded |
| SDK missing `ProofType.MerkleBatchUpdate` | Medium | Blocks `findMerkleBatchVkPda` SDK equivalent |
| `validate:config` fails in clean env | Low | Expected — requires operator RPC env vars |
| Polygon Amoy lacks deployment block receipt | Low | Falls back to `0n`; no functional impact |

None of these blockers prevent relayer operation. The SDK wiring decision is documented and deferred.

---

## 17. Next Recommended PR

**PR-009F — Relayer API Hardening**

Focus areas:
- Input validation middleware for HTTP/API endpoints
- Rate limiting and authentication
- Structured logging correlation IDs
- Health check endpoint
- Metrics exposure (Prometheus-compatible)

**Do NOT start until this PR-009E report is accepted.**
