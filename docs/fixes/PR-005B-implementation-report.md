# PR-005B Implementation Report

**Title:** Protocol-Scoped Domain ID + v2 Asset ID Formula for New Deployments
**Phase:** Phase 1 of Option D (Hybrid Phased Approach) from PR-005A
**Date:** 2026-05-01
**Status:** ✅ Implemented & Tested

## Summary

Implemented the v2 asset ID formula with protocol-scoped domain separation for all new deployments, while preserving full backward compatibility with existing v1 pools (Base Sepolia PR-004, Solana Devnet). No circuit changes, no verifier regeneration, no existing deployment breakage.

## Domain ID Registry

| Network | Hex | Decimal | Family |
|---------|-----|---------|--------|
| Solana Devnet | `0x01000002` | 16777218 | Solana |
| Base Sepolia | `0x02000002` | 33554434 | EVM |
| Ethereum Sepolia | `0x02000003` | 33554435 | EVM |
| Polygon Amoy | `0x02000004` | 33554436 | EVM |
| Polygon zkEVM Cardona | `0x02000005` | 33554437 | EVM |
| BSC Testnet | `0x02000006` | 33554438 | EVM |
| Base Mainnet | `0x02000007` | 33554439 | EVM |
| Ethereum Mainnet | `0x02000008` | 33554440 | EVM |
| Polygon Mainnet | `0x02000009` | 33554441 | EVM |
| Polygon zkEVM Mainnet | `0x0200000a` | 33554442 | EVM |
| BSC Mainnet | `0x0200000b` | 33554443 | EVM |

Structure: `uint32` — high byte = chain family (`0x01` = Solana, `0x02` = EVM), low 3 bytes = network ID.

## v2 Asset ID Formula

```
assetId = 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]
```

This ensures:
- **Field safety:** MSB is zero, keeping value < 2^248 < BN254 field prime
- **Domain separation:** Same token on different chains produces different asset IDs
- **Version prefix:** `"white:asset_id:v2"` prevents collision with v1

## Files Changed

### EVM Contracts
- `chains/evm/contracts/AssetRegistry.sol`
  - Added `domainId` (uint32), `assetIdVersion` (uint8), `isLegacyV1` (bool)
  - Added `configureDomain(uint32, uint8)` one-time setter
  - `_computeAssetId` now branches on version (v1/v2)
  - Old constructor unchanged → backward compatible

- `chains/evm/contracts/WhiteProtocol.sol`
  - Added `domainId` (uint32) with `setDomainId(uint32)` one-time setter
  - Existing constructor unchanged → backward compatible

### EVM Deployment & Config
- `chains/evm/configs/networks.json`
  - Added `domainId` field to all 10 networks

- `chains/evm/script/Deploy.s.sol`
  - Reads `domainId` from config
  - Calls `assetRegistry.configureDomain(domainId, 2)` after deployment
  - Calls `whiteProtocol.setDomainId(domainId)` after deployment

### EVM Tests
- `chains/evm/test/AssetRegistry.t.sol`
  - All 6 existing v1 tests preserved and passing
  - Added 9 new v2 tests:
    - `test_V2AssetIdIsFieldSafe`
    - `test_V2AssetIdFormulaMatchesCanonical`
    - `test_V2AssetIdDiffersFromV1`
    - `test_V2AssetIdDiffersAcrossDomains`
    - `test_ConfigureDomainEmitsEvent`
    - `test_ConfigureDomainOnlyOnce`
    - `test_ConfigureDomainOnlyOwner`
    - `test_ConfigureDomainInvalidVersion`
    - `test_V2RegistryStateAfterConfigure`

### TypeScript Core
- `packages/core/src/domains.ts` (new)
  - `ProtocolDomain` enum with all domain IDs
  - `ChainFamily` enum
  - Helper functions: `decomposeDomainId`, `composeDomainId`, `domainIdToBytes`, `domainIdToName`

- `packages/core/src/crypto.ts`
  - Renamed `computeAssetId` → `computeAssetIdV1` (explicit)
  - Added `computeAssetIdV2(token, domainId)`
  - Added `computeAssetIdV1BigInt`, `computeAssetIdV2BigInt`
  - Preserved `computeAssetId` and `computeAssetIdBigInt` as backward-compatible aliases

- `packages/core/src/index.ts`
  - Exports all new crypto functions and domain registry

### App Frontend
- `app/src/lib/crypto.ts`
  - Same v1/v2 split as core crypto.ts
  - Backward-compatible aliases preserved

### Solana Program (Helper Parity)
- `chains/solana/programs/white-protocol/src/state/asset_vault.rs`
  - Added `compute_asset_id_v1` (explicit)
  - Added `compute_asset_id_v2(mint, domain_id)`
  - `compute_asset_id` remains v1 alias for backward compatibility
  - No struct size changes → no account migration needed

### Solana SDK
- `chains/solana/sdk/src/crypto/keccak.ts`
  - Added `deriveAssetIdV1`, `deriveAssetIdV2(mint, domainId)`
  - `deriveAssetId` remains v1 alias

### Relayer
- `relayer/src/api-extensions.ts`
  - Added `computeAssetIdV1`, `computeAssetIdV2`
  - `computeAssetId` remains v1 alias

## Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| EVM Foundry (all) | 70 | ✅ Pass |
| Solana Rust (white-protocol lib) | 97 | ✅ Pass |
| TypeScript Core (vitest) | 26 | ✅ Pass |

### EVM Test Breakdown
- `AssetRegistry.t.sol`: 15 passed (6 v1 legacy + 9 v2 new)
- `WhiteProtocol.t.sol`: 11 passed (all legacy, unchanged)
- `StealthWithdrawal.t.sol`: 9 passed (all legacy, unchanged)
- `WhiteProtocolBridgeHooks.t.sol`: 8 passed (all legacy, unchanged)
- Bridge tests: 19 passed (all legacy, unchanged)
- `PoseidonHash.t.sol`: 8 passed (all legacy, unchanged)

## Backward Compatibility

- **Existing deployments:** No changes required. Base Sepolia (PR-004) and Solana Devnet continue using v1.
- **Existing tests:** All compile and pass without modification. Old `new AssetRegistry(owner)` constructor defaults to v1.
- **TypeScript SDK:** `computeAssetId()` and `computeAssetIdBigInt()` remain v1 aliases. No breaking changes for consumers.
- **Circuits:** Unchanged. v2 asset IDs are still 32-byte field-safe values.
- **Verifiers:** No regeneration needed.

## Deployment Notes for New Networks

When deploying to a new EVM network (e.g. Ethereum Sepolia, Base Mainnet post-audit):

1. Ensure `domainId` is set in `chains/evm/configs/networks.json`
2. Run `Deploy.s.sol` normally — it will automatically:
   - Deploy `AssetRegistry` with legacy constructor
   - Call `configureDomain(domainId, 2)` to switch to v2
   - Deploy `WhiteProtocol`
   - Call `setDomainId(domainId)`
   - Transfer ownership and add assets (all using v2 formula)

## Deferred to Phase 2 (Future PR)

- Circuit-level `domain_id` public input
- PoolConfig struct size change for explicit `domain_id` field (Solana)
- Cross-chain bridge domain enforcement
- Migration guide for upgrading v1 pools to v2

## Acceptance Criteria Checklist

- [x] v2 formula implemented in Solidity (`_computeAssetIdV2`)
- [x] v1 formula preserved (`_computeAssetIdV1`) 
- [x] Solidity/TypeScript formulas match exactly
- [x] Field-safe tests pass for both v1 and v2
- [x] Existing tests pass without modification
- [x] No circuit changes
- [x] No verifier regeneration
- [x] No existing deployment breakage
- [x] Domain registry created and documented
- [x] Deployment script updated for new networks
