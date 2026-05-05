# SDK Wiring Audit — `@whiteprotocol/sdk`

**Date:** 2026-05-04  
**Auditor:** PR-009F  
**Decision:** ❌ **Do NOT wire relayer to SDK at this time.** Keep internal PDA helpers.

---

## Executive Summary

The relayer's Solana PDA derivation helpers (`src/solana-pdas.ts`) were audited against `@whiteprotocol/sdk` (built from `chains/solana/sdk`). The SDK's PDA seeds target a **future program revision** that does not match the **currently deployed devnet program**. Wiring the SDK today would cause the relayer to derive incorrect PDAs, leading to failed transactions and potential loss of funds.

---

## 1. PDA Seed Mismatches

| Account | SDK Seed | On-Chain Seed (deployed) | Risk if using SDK |
|---------|----------|--------------------------|-------------------|
| `PoolConfig` | `pool_v2` | `white_pool` | ❌ Wrong pool address — all operations fail |
| `MerkleTree` | `merkle_tree_v2` | `merkle_tree` | ❌ Wrong tree PDA — root mismatch |
| `AssetVault` | `vault_v2` | `vault` | ❌ Wrong vault — token transfers fail |
| `SpentNullifier` | `nullifier_v2` | `nullifier` | ❌ Double-spend protection bypassed |
| `PendingDepositsBuffer` | `pending_deposits` | `pending` | ❌ Batch settlement fails |
| `VerificationKey` | `vk_v2` + type seed | `vk_{type}` directly | ⚠️ Different derivation path |

### Evidence

**SDK `.d.ts` declarations** (`chains/solana/sdk/dist/pda.d.ts`):
```typescript
// findPoolConfigPda seeds: ["pool_v2", authority]
// findMerkleTreePda seeds: ["merkle_tree_v2", pool_config]
// findAssetVaultPda seeds: ["vault_v2", pool_config, asset_id]
// findSpentNullifierPda seeds: ["nullifier_v2", pool_config, nullifier_hash]
// findPendingBufferPda seeds: ["pending_deposits", pool_config]
```

**On-chain program source** (`chains/solana/programs/white-protocol/src/state/`):
```rust
// pool_config.rs
pub const SEED_PREFIX: &[u8] = b"white_pool";

// merkle_tree.rs
pub const SEED_PREFIX: &[u8] = b"merkle_tree";

// asset_vault.rs
pub const SEED_PREFIX: &[u8] = b"vault";

// spent_nullifier.rs
pub const SEED_PREFIX: &[u8] = b"nullifier";

// pending_deposits.rs
pub const SEED_PREFIX: &[u8] = b"pending";
```

---

## 2. ProofType Enum Gap

The on-chain program defines `ProofType::MerkleBatchUpdate = 4`, which the SDK omits entirely.

### On-Chain (`lib.rs`)
```rust
pub enum ProofType {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3,
    MerkleBatchUpdate = 4,  // ← MISSING FROM SDK
    WithdrawV2 = 5,
}
```

### SDK (`types.d.ts`)
```typescript
export declare enum ProofType {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3,
    WithdrawV2 = 5
    // MerkleBatchUpdate = 4 is ABSENT
}
```

### Impact

The relayer's batch settlement sequencer derives the `vk_merkle_batch` PDA:

```typescript
// relayer/src/solana-pdas.ts
export function findMerkleBatchVkPda(poolConfig: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vk_merkle_batch'), poolConfig.toBuffer()],
    programId
  );
}
```

The SDK's `findVerificationKeyPda` uses `vk_v2` + `proofTypeSeed(proofType)`. Because `MerkleBatchUpdate` is missing from the SDK enum, there is **no SDK equivalent** for this PDA. The relayer would have to keep an internal helper anyway.

---

## 3. Parameter Order Differences

The SDK and relayer helpers use **different parameter ordering**:

| Function | SDK Signature | Relayer Signature |
|----------|--------------|-------------------|
| `findPoolConfigPda` | `(programId, authority)` | N/A (relayer reads poolConfig from config) |
| `findMerkleTreePda` | `(programId, poolConfig)` | `(poolConfig, programId?)` |
| `findAssetVaultPda` | `(programId, poolConfig, assetId)` | `(poolConfig, assetId, programId?)` |

Wiring the SDK would require refactoring every call site in `src/index.ts` and `src/solana-fee-validator.ts`.

---

## 4. Missing SDK Helpers

The following relayer-specific PDAs have **no equivalent** in the SDK:

| Helper | Seed | Used By |
|--------|------|---------|
| `findVaultTokenAccountPda` | `vault_token` | Solana withdrawals (token account for vault) |
| `findYieldRegistryPda` | `yield_registry` | Solana withdrawals (yield registry account) |
| `findMerkleBatchVkPda` | `vk_merkle_batch` | Batch settlement sequencer |
| `findWithdrawVkPda` | `vk_withdraw` | Legacy withdrawal VK |
| `findWithdrawV2VkPda` | `vk_withdraw_v2` | V2 withdrawal VK |

---

## 5. SDK Version Status

From `chains/solana/sdk/dist/index.d.ts`:
```typescript
export declare const SDK_VERSION = "2.0.0";
export declare const IS_PRODUCTION_READY = false;
export declare const SDK_STATUS = "alpha";
```

The SDK is explicitly marked as **not production-ready**. The seed changes suggest it was written against a planned program upgrade that has not yet been deployed.

---

## 6. Recommendation

### Short Term (Current Sprint)
- ✅ **Keep** `src/solana-pdas.ts` as the source of truth for Solana PDA derivation.
- ✅ **Do NOT** add `@whiteprotocol/sdk` as a relayer dependency.
- ✅ **Document** the incompatibility in this file and in `solana-pdas.ts` header comments.

### Medium Term (Post-Program Upgrade)
When the on-chain program is upgraded to use v2 seeds:
1. Update `@whiteprotocol/sdk` to add `ProofType.MerkleBatchUpdate`.
2. Add missing helpers (`findVaultTokenAccountPda`, `findYieldRegistryPda`) to the SDK.
3. Re-audit SDK seeds against the upgraded program.
4. Only then wire the relayer to the SDK and remove `solana-pdas.ts`.

### Test Coverage
All relayer PDA helpers are covered by unit tests (`src/__tests__/solana-pdas.test.ts`). If the SDK is ever wired, those tests should be migrated to verify SDK parity instead.

---

## Appendix: File References

| File | Purpose |
|------|---------|
| `relayer/src/solana-pdas.ts` | Internal PDA helpers (source of truth) |
| `relayer/src/__tests__/solana-pdas.test.ts` | Unit tests for PDA derivation |
| `chains/solana/sdk/dist/pda.d.ts` | SDK PDA declarations |
| `chains/solana/sdk/dist/types.d.ts` | SDK ProofType enum |
| `chains/solana/programs/white-protocol/src/state/*.rs` | On-chain seed definitions |
