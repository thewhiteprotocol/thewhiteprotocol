# PR-009B — Relayer Env/Config Validation and TypeScript Build Cleanup

**Date:** 2026-05-04
**Status:** ✅ Complete
**Parent:** PR-009 — Multi-chain relayer readiness audit

---

## 1. Summary

Fixed the relayer's immediate build/config blockers so PR-009C runtime hardening can start from a clean baseline.

Changes made:
- Fixed 2 TypeScript compilation errors
- Aligned RPC env var names across `networks.json`, `.env.example`, `render.yaml`, and runtime
- Added per-chain EVM deployer key support with shared fallback
- Removed proven dead code (`BaseAdapter`, `BaseSequencer`, legacy config fields)
- Added startup config validation script (`npm run validate:config`)
- Added `npm run typecheck` script

No runtime settlement logic was changed. No secrets were printed or committed.

---

## 2. What PR-009 Found

1. **RPC env var mismatch:** `networks.json` expected `BASE_SEPOLIA_RPC_URL`, but `.env.example` and `render.yaml` used `BASE_RPC_URL`. Same for Ethereum (`ETH_RPC_URL` vs `ETHEREUM_SEPOLIA_RPC_URL`) and BNB (`BSC_RPC_URL` vs `BSC_TESTNET_RPC_URL`).
2. **TypeScript build errors:**
   - `relayer/src/chains/solana.ts:29` — `AnchorWallet` private `payer` property incompatible with Anchor `Wallet` interface.
   - `relayer/src/index.ts:1932` — `bscRpcUrl` / `ethRpcUrl` / legacy fields assigned to `RelayerConfig` but not declared in the interface.
3. **Dead code:** `relayer/src/chains/base.ts` and `relayer/src/base-sequencer.ts` were only referenced by each other and not imported by active runtime.
4. **Single shared deployer key:** All EVM chains used `config.baseDeployerPrivateKey`.
5. **Missing env docs:** Stealth scanner env vars and some deployer key comments missing from `render.yaml`.

---

## 3. RPC Env Var Alignment Table

| Chain | `networks.json` RPC env | Old `.env.example` / `render.yaml` | Final canonical env | Backward alias |
|-------|------------------------|-----------------------------------|---------------------|----------------|
| Base Sepolia | `BASE_SEPOLIA_RPC_URL` | `BASE_RPC_URL` | `BASE_SEPOLIA_RPC_URL` | `BASE_RPC_URL`¹ |
| Ethereum Sepolia | `ETHEREUM_SEPOLIA_RPC_URL` | `ETH_RPC_URL` | `ETHEREUM_SEPOLIA_RPC_URL` | `ETH_RPC_URL`¹ |
| BNB Testnet | `BSC_TESTNET_RPC_URL` | `BSC_RPC_URL` | `BSC_TESTNET_RPC_URL` | `BSC_RPC_URL`¹ |
| Polygon Amoy | `POLYGON_AMOY_RPC_URL` | `POLYGON_AMOY_RPC_URL` | `POLYGON_AMOY_RPC_URL` | — |

¹ Backward aliases are supported by `config.ts:getRpcUrl()` with a deprecation warning printed to stderr.

---

## 4. Final Canonical Env Var Names

### RPC URLs
- `BASE_SEPOLIA_RPC_URL`
- `ETHEREUM_SEPOLIA_RPC_URL`
- `BSC_TESTNET_RPC_URL`
- `POLYGON_AMOY_RPC_URL`

### Protocol Addresses
- `BASE_PROTOCOL_ADDRESS`
- `ETH_PROTOCOL_ADDRESS`
- `BSC_PROTOCOL_ADDRESS`
- `POLYGON_AMOY_PROTOCOL_ADDRESS`

### Deployer Private Keys (per-chain, preferred)
- `BASE_DEPLOYER_PRIVATE_KEY`
- `ETH_DEPLOYER_PRIVATE_KEY`
- `BSC_DEPLOYER_PRIVATE_KEY`
- `POLYGON_AMOY_DEPLOYER_PRIVATE_KEY`

### Shared Fallback
- `EVM_DEPLOYER_PRIVATE_KEY` — used only if a per-chain key is missing

---

## 5. Backward-Compatible Aliases

`config.ts:getRpcUrl()` supports legacy aliases with a console warning:

```typescript
const RPC_ENV_ALIASES: Record<string, string[]> = {
  BASE_SEPOLIA_RPC_URL: ['BASE_RPC_URL'],
  ETHEREUM_SEPOLIA_RPC_URL: ['ETH_RPC_URL'],
  BSC_TESTNET_RPC_URL: ['BSC_RPC_URL'],
};
```

Similarly, `getDeployerPrivateKey()` supports legacy key names:

```typescript
const DEPLOYER_KEY_ALIASES: Record<string, string[]> = {
  'base-sepolia': ['BASE_DEPLOYER_PRIVATE_KEY', 'BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY'],
  'ethereum-sepolia': ['ETH_DEPLOYER_PRIVATE_KEY', 'ETHEREUM_SEPOLIA_DEPLOYER_PRIVATE_KEY'],
  'bsc-testnet': ['BSC_DEPLOYER_PRIVATE_KEY', 'BSC_TESTNET_DEPLOYER_PRIVATE_KEY'],
  'polygon-amoy': ['POLYGON_AMOY_DEPLOYER_PRIVATE_KEY'],
};
```

---

## 6. TypeScript Errors Fixed

### Error 1: `AnchorWallet` type mismatch
**File:** `relayer/src/chains/solana.ts`
**Fix:** Changed `private payer` to `readonly payer` so it satisfies the Anchor `Wallet` interface.

```typescript
// Before
class AnchorWallet {
  constructor(private payer: Keypair) {}
}

// After
class AnchorWallet {
  constructor(readonly payer: Keypair) {}
}
```

### Error 2: Legacy fields not in `RelayerConfig`
**File:** `relayer/src/index.ts`
**Fix:** Removed the legacy fields (`baseRpcUrl`, `baseProtocolAddress`, `baseDeployerPrivateKey`, `bscRpcUrl`, `bscProtocolAddress`, `bscDeployerPrivateKey`, `ethRpcUrl`, `ethProtocolAddress`, `ethDeployerPrivateKey`) from both the `RelayerConfig` interface and the `main()` function. The dynamic `getEvmChainContexts()` loader now handles all EVM chain initialization.

---

## 7. Per-Chain Key Support Design

**Before:** All EVM chains used `config.baseDeployerPrivateKey`:
```typescript
privateKey: config.baseDeployerPrivateKey as `0x${string}`,
```

**After:** Each chain resolves its own key via `getDeployerPrivateKey(name)`:
```typescript
const deployerKey = getDeployerPrivateKey(ctx.name);
if (!deployerKey) {
  logger.warn(`No deployer private key for "${ctx.name}". Skipping EVM adapter.`);
  continue;
}
privateKey: deployerKey as `0x${string}`,
```

**Resolution order:**
1. Per-chain key (e.g., `BASE_DEPLOYER_PRIVATE_KEY`)
2. Canonical per-chain key (e.g., `BASE_SEPOLIA_DEPLOYER_PRIVATE_KEY`)
3. Shared fallback (`EVM_DEPLOYER_PRIVATE_KEY`)
4. If none found, adapter is skipped with a clear warning.

---

## 8. Config Validation Behavior

**Command:** `npm run validate:config`

Runs `validateConfig()` from `config.ts`, which checks:
- Live chains loaded from `networks.json`
- RPC env vars present (canonical or alias)
- Deployment artifacts exist
- Deployer keys present (or warns with env var names)
- Domain ID consistency against known values
- Asset ID version == 2 in deployment artifacts

**Example output (all env set):**
```
Live chains: base-sepolia, ethereum-sepolia, polygon-amoy, bsc-testnet
Status: ✅ OK
```

**Example output (missing env):**
```
Live chains: base-sepolia, ethereum-sepolia, polygon-amoy, bsc-testnet
Status: ❌ FAILED
Warnings:
  ⚠️  [base-sepolia] No deployer private key found...
Errors:
  ❌ [base-sepolia] Missing RPC URL for network "base-sepolia"...
```

No secret values are ever printed. Only env var **names** and chain names are shown.

---

## 9. Dead Code Removed or Retained

| File | Action | Evidence |
|------|--------|----------|
| `relayer/src/chains/base.ts` | **Removed** | Only imported by `base-sequencer.ts` (now also removed). grep confirmed zero other references. |
| `relayer/src/base-sequencer.ts` | **Removed** | Only imported itself. grep confirmed zero other references. |
| Legacy `baseRpcUrl` / `baseProtocolAddress` / `baseDeployerPrivateKey` in `RelayerConfig` | **Removed** | Replaced by dynamic `getEvmChainContexts()` + `getDeployerPrivateKey()`. |
| Legacy `bscRpcUrl` / `ethRpcUrl` etc. in `main()` | **Removed** | Same reason. |

No active runtime code imported these files or fields.

---

## 10. `.env.example` Changes

- Updated RPC env vars to canonical names:
  - `BASE_SEPOLIA_RPC_URL`
  - `ETHEREUM_SEPOLIA_RPC_URL`
  - `BSC_TESTNET_RPC_URL`
  - `POLYGON_AMOY_RPC_URL`
- Added comment documenting backward-compatible legacy aliases.
- Added `EVM_DEPLOYER_PRIVATE_KEY` shared fallback documentation.
- Reorganized into clear per-chain sections.
- Added note that stealth scanner currently supports Solana + Base only.

---

## 11. `render.yaml` Changes

- Updated RPC env vars to canonical names (same as `.env.example`).
- Added stealth scanner env vars:
  - `STEALTH_SCANNER_POLL_INTERVAL_MS`
  - `STEALTH_SCANNER_BATCH_SIZE`
  - `STEALTH_SOLANA_RPC_URL`
  - `STEALTH_BASE_RPC_URL`
  - `STEALTH_META_ADDRESS_VERSION`
- Expanded secrets comment to include all deployer keys:
  - `BASE_DEPLOYER_PRIVATE_KEY`
  - `ETH_DEPLOYER_PRIVATE_KEY`
  - `BSC_DEPLOYER_PRIVATE_KEY`
  - `POLYGON_AMOY_DEPLOYER_PRIVATE_KEY`
  - `EVM_DEPLOYER_PRIVATE_KEY`

---

## 12. Commands Run

```bash
# TypeScript compilation
cd relayer && npx tsc --noEmit
# Result: PASSED (0 errors)

# Build
cd relayer && npm run build
# Result: PASSED

# Config validation (with all env vars set)
cd relayer && npm run validate:config
# Result: PASSED — 4 live chains, 0 warnings, 0 errors

# Config validation (without env vars)
cd relayer && npx tsx src/validate-config.ts
# Result: FAILED — correctly reports missing RPC URLs and missing deployer keys
```

---

## 13. Build/Typecheck Results

| Check | Before PR-009B | After PR-009B |
|-------|----------------|---------------|
| `tsc --noEmit` | ❌ 2 errors | ✅ 0 errors |
| `npm run build` | ❌ Fails (tsc errors) | ✅ Passes |
| `npm run validate:config` | ❌ Did not exist | ✅ Works |

---

## 14. Files Changed

| File | Change |
|------|--------|
| `relayer/src/chains/solana.ts` | Fixed `AnchorWallet` type (`private` → `readonly payer`) |
| `relayer/src/config.ts` | Added `domainId` to `NetworkConfig`, `RPC_ENV_ALIASES`, `DEPLOYER_KEY_ALIASES`, `getDeployerPrivateKey()`, `validateConfig()` |
| `relayer/src/index.ts` | Removed legacy `base*`/`bsc*`/`eth*` fields from `RelayerConfig` and `main()`; wired `getDeployerPrivateKey()` per chain |
| `relayer/src/validate-config.ts` | **New** — standalone config validation CLI |
| `relayer/package.json` | Added `"validate:config"` and `"typecheck"` scripts |
| `relayer/.env.example` | Aligned RPC env vars to canonical names; added alias documentation; reorganized per-chain |
| `render.yaml` | Aligned RPC env vars to canonical names; added stealth scanner envs; expanded secrets comment |
| `relayer/src/chains/base.ts` | **Deleted** — dead code |
| `relayer/src/base-sequencer.ts` | **Deleted** — dead code |

---

## 15. Remaining Blockers

These are **out of scope for PR-009B** and will be addressed in subsequent PRs:

1. **EVM sequencer double-submit risk** — PR-009C
2. **EVM settlement lacks retry/circuit breaker** — PR-009C
3. **Event scanning from block 0** — PR-009C
4. **Zero relayer test coverage** — PR-009E
5. **Stealth withdrawal path unreachable** (`length === 32` bug) — PR-009C
6. **Chain parameter not validated against live list in API** — PR-009F
7. **Flat fee model (no per-chain gas awareness)** — PR-009F
8. **No lock file for multi-instance state safety** — PR-009E
9. **Solana adapter file is orphaned stub** — PR-009D

---

## 16. Next Recommended PR

**PR-009C: EVM Relayer Multi-Chain Runtime Hardening**

Focus:
- Add in-flight settlement tracking to `EvmSequencer`
- Wrap `submitSettlement` in `withRetry` + circuit breaker
- Add deployment block numbers to deployment artifacts
- Fix stealth ephemeral pubkey length check (`32` → `33`)
- Add BSC Testnet poll interval tuning
- Add chain-specific gas overrides for BNB/Polygon
