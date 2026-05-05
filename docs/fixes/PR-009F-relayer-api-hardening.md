# PR-009F — Relayer API Hardening and Chain Gating

**Date:** 2026-05-04  
**Status:** ✅ COMPLETE  
**Base:** PR-009E (relayer tests + SDK wiring audit)

---

## 1. Summary

PR-009F hardened the relayer API layer by introducing a canonical chain registry, enforcing chain validation on all chain-aware endpoints, removing unsafe defaults, and adding a domain-aware asset ID endpoint. All API responses now include chain metadata where relevant, and error responses follow a standardized shape.

No bridges, contracts, circuits, or on-chain programs were modified.

---

## 2. Starting State from PR-009E Audit

| Finding | Severity | Status after PR-009F |
|---------|----------|----------------------|
| `/withdraw` defaults to `base-sepolia` when `chain` omitted | High | ✅ Fixed — now returns 400 `MISSING_CHAIN` |
| `/withdraw` accepts any non-solana string as EVM chain | High | ✅ Fixed — validated against chain registry |
| `/quote` uses global flat fee, not chain-aware | Medium | ✅ Fixed — returns chain metadata + honest gas disclaimer |
| `/api/compute-asset-id` is Solana-only v1 | Medium | ✅ Fixed — new `/api/asset-id` supports EVM + Solana, v1 + v2 |
| No chain registry for centralized validation | Medium | ✅ Fixed — `chain-registry.ts` added |
| API error responses inconsistent | Low | ✅ Fixed — standardized `{ success: false, error: { code, message } }` |
| `/assets` returns flat strings | Low | ✅ Fixed — returns structured asset metadata grouped by chain |

---

## 3. API Route Matrix

| Route | Method | Previous Behavior | New Behavior |
|-------|--------|-------------------|--------------|
| `/health` | GET | Basic status + memory | + `liveChains` array with chainKey/family/chainId/domainId/assetIdVersion |
| `/status` | GET | Relayer status | + `liveChains` with protocolAddress per chain |
| `/metrics` | GET | In-memory counters | Unchanged (already chain-aware via `withdrawalsByChain`) |
| `/quote` | GET | Global flat fee | Requires `chain` query param; returns chain-aware quote with `feeModel: "flat_bps"`, `gasAware: false`, and chain metadata |
| `/assets` | GET | Flat string list | Accepts optional `chain`; returns structured `AssetInfo[]` with address, symbol, decimals, isNative, domainId, assetIdVersion |
| `/withdraw` | POST | Defaults to Base | **Requires** `chain` in body; validates against registry; normalizes aliases; rejects unknown/non-live chains |
| `/api/asset-id` | GET | — | **New** — chain-aware, v1/v2, EVM + Solana |
| `/api/compute-asset-id` | POST | Solana-only v1 | Marked deprecated; backward-compatible |

---

## 4. Chain Registry Design

**File:** `relayer/src/chain-registry.ts`

### Sources of Truth
- **EVM chains:** `chains/evm/configs/networks.json` (same file used by deployment and config validation)
- **Solana:** Hardcoded entry for Solana Devnet

### Live Chains
| chainKey | Aliases | Family | chainId | domainId | assetIdVersion |
|----------|---------|--------|---------|----------|----------------|
| `solana` | `sol` | solana | — | 33554433 | 1 |
| `base-sepolia` | `base` | evm | 84532 | 33554434 | 2 |
| `ethereum-sepolia` | `eth`, `ethereum` | evm | 11155111 | 33554435 | 2 |
| `bsc-testnet` | `bnb`, `bsc` | evm | 97 | 33554438 | 2 |
| `polygon-amoy` | `polygon` | evm | 80002 | 33554436 | 2 |

### Non-Live Chains (rejected with `CHAIN_NOT_LIVE`)
- `base-mainnet`, `ethereum-mainnet`, `bsc-mainnet`, `polygon-mainnet`

### Alias Precedence
Live chain aliases take precedence over non-live chain aliases. For example, `base` resolves to `base-sepolia` (live) even though `base-mainnet` also has the `base` alias.

---

## 5. Withdrawal Chain Validation

**File:** `relayer/src/index.ts`

### Behavior
1. `chain` is **required** in the request body.
2. Chain is validated via `validateChainParameter()` before any proof parsing or expensive operations.
3. Aliases are normalized to canonical chain keys.
4. Unknown chains → `400 UNSUPPORTED_CHAIN`
5. Missing chain → `400 MISSING_CHAIN`
6. Non-live chains → `400 CHAIN_NOT_LIVE`
7. Family determines routing:
   - `solana` → `processSolanaWithdrawal`
   - `evm` → `processBaseWithdrawal`
8. `validateWithdrawRequest` now receives the chain family (`'solana' | 'evm'`) instead of inferring it from `chain === 'base'`.

### Error Response Shape
```json
{
  "success": false,
  "error": {
    "code": "MISSING_CHAIN",
    "message": "Missing required 'chain' parameter. Supported chains: ...",
    "details": { "supportedChains": ["base-sepolia", ...] }
  }
}
```

---

## 6. Quote Changes

**File:** `relayer/src/index.ts` (route handler)

### Requirements
- `chain` query parameter is **required**.
- Returns chain metadata: `chainKey`, `chainId`, `domainId`, `assetIdVersion`, `nativeGasToken`.
- Honest about gas-awareness: `gasAware: false`, `gasWarning: "Gas-aware quote pending implementation"`, `feeModel: "flat_bps"`.

### Response Shape
```json
{
  "amount": "1000000",
  "relayerFee": "5000",
  "feeBps": 50,
  "netAmount": "995000",
  "feeModel": "flat_bps",
  "gasAware": false,
  "gasWarning": "Gas-aware quote pending implementation",
  "chainKey": "base-sepolia",
  "chainId": 84532,
  "domainId": 33554434,
  "assetIdVersion": 2,
  "nativeGasToken": "ETH",
  "relayerAddresses": {
    "solana": "...",
    "evm": { "base-sepolia": "0x..." }
  }
}
```

---

## 7. Assets Endpoint Changes

**File:** `relayer/src/index.ts` (route handler + `getAssetsForChain`)

### Behavior
- `GET /assets?chain=base-sepolia` returns assets for that chain only.
- `GET /assets` returns grouped assets for all live chains.
- EVM assets are derived from deployment artifacts (`supportedAssets` in deployment JSON).
- Solana assets fall back to `supportedAssets` set.

### AssetInfo Structure
```typescript
{
  chainKey: string;
  chainId?: number;
  domainId: number;
  assetIdVersion: number;
  address: string;
  symbol: string;
  decimals: number;
  isNative: boolean;
}
```

---

## 8. Asset ID Endpoint Changes

**File:** `relayer/src/api-extensions.ts` (new GET `/api/asset-id`)

### New Endpoint: `GET /api/asset-id`

Query parameters:
- `chain` (required) — chain key or alias
- `token` (required) — token/mint address
- `version` (optional) — `1` or `2`; defaults to chain's `assetIdVersion`

Response:
```json
{
  "success": true,
  "assetId": "0x00...",
  "assetIdBigInt": "12345...",
  "formula": "0x00 || keccak256(\"white:asset_id:v2\" || uint32BE(domainId) || tokenAddress)[0..31]",
  "version": 2,
  "domainId": 33554434,
  "fieldSafe": true,
  "chainKey": "base-sepolia",
  "chainId": 84532,
  "token": "0x..."
}
```

### Validation
- Rejects invalid chain → `400`
- Rejects missing token → `400 INVALID_ADDRESS`
- Validates Solana pubkey format for `family=solana`
- Validates EVM address format (0x + 40 hex) for `family=evm`
- Solana only supports version `1`
- EVM supports versions `1` and `2`

### Legacy Endpoint
`POST /api/compute-asset-id` remains functional but is marked deprecated in its response:
```json
{
  "note": "Deprecated: use GET /api/asset-id?chain=solana&token=<mint>"
}
```

---

## 9. Health/Status/Metrics Changes

### `/health`
Added `liveChains` array:
```json
{
  "liveChains": [
    { "chainKey": "solana", "family": "solana", "domainId": 33554433, "assetIdVersion": 1, "isLive": true },
    { "chainKey": "base-sepolia", "family": "evm", "chainId": 84532, "domainId": 33554434, "assetIdVersion": 2, "isLive": true }
  ]
}
```

### `/status`
Added `liveChains` with `protocolAddress` per chain (Solana program ID or EVM relayer address).

### `/metrics`
No changes required — `MetricsCollector` already supports `withdrawalsByChain` labels.

---

## 10. Error Response Standardization

**File:** `relayer/src/chain-registry.ts` (`createApiError`)

### Standard Shape
```json
{
  "success": false,
  "error": {
    "code": "CODE_NAME",
    "message": "Human-readable message",
    "details": { /* optional */ }
  }
}
```

### Error Codes Used
| Code | Used When |
|------|-----------|
| `MISSING_CHAIN` | `chain` parameter missing or empty |
| `UNSUPPORTED_CHAIN` | Chain not in registry |
| `CHAIN_NOT_LIVE` | Chain in registry but `isLive=false` |
| `INVALID_ADDRESS` | Token/mint address malformed |
| `INVALID_ASSET_ID` | Asset ID computation failed |
| `WITHDRAWAL_FAILED` | Catch-all for withdrawal processing errors |
| `INTERNAL_ERROR` | Unhandled server error |

### Security
- Error messages never contain:
  - Private keys
  - RPC URLs
  - Proof inputs or nullifier preimages
  - Environment variable values
  - Full stack traces to client (logged server-side only)

---

## 11. Tests Added

| File | Tests | Coverage |
|------|-------|----------|
| `src/__tests__/chain-registry.test.ts` | 26 | Registry building, alias resolution, validation, quote builder, asset builder, error formatting |
| `src/__tests__/asset-id.test.ts` | 24 | Solana v1, EVM v1/v2, unified interface, validation helpers |
| `src/__tests__/api-chain-validation.test.ts` | 23 | Withdrawal chain validation, quote metadata, alias normalization, error standardization |

**Total new tests: 73**  
**Grand total across all suites: 175 tests passing**

---

## 12. Commands Run

```bash
cd relayer && npm run typecheck
cd relayer && npm run build
cd relayer && npx jest --testPathPatterns='__tests__'
cd relayer && npm run validate:config
```

---

## 13. Test / Typecheck / Build Results

```
Test Suites: 11 passed, 11 total
Tests:       175 passed, 175 total
Snapshots:   0 total

> npm run typecheck
  (clean — no output)

> npm run build
  (success)

> npm run validate:config
  Status: ❌ FAILED
  Errors: Missing RPC URLs for all live chains (expected in clean Codespace)
  Warnings: Missing deployer keys (expected)
```

---

## 14. Remaining Blockers

| Blocker | Severity | Notes |
|---------|----------|-------|
| `validate:config` fails in clean env | Low | Expected — requires operator RPC env vars |
| Gas-aware quoting not implemented | Low | Documented as `gasAware: false` with warning |
| SDK wiring still deferred | Medium | Unchanged from PR-009E |

---

## 15. Next Recommended PR

**PR-010 — Bridge Integration Preparation**

Focus areas:
- Bridge message format standardization
- Cross-chain nullifier tracking
- Bridge relayer message validation
- Domain ID consistency checks across chains

**Do NOT start until this PR-009F report is accepted.**
