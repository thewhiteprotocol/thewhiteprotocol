# PR-009 — Multi-Chain Relayer Readiness Audit and Implementation Plan

**Date:** 2026-05-04
**Auditor:** Kimi Code CLI
**Scope:** Relayer runtime for all active non-bridge chains
**Status:** ✅ Audit complete — runtime code NOT modified

---

## 1. Summary

This PR audits the relayer/sequencer runtime readiness for all five active The White Protocol chains **before bridge work begins**:

1. **Solana Devnet** — functional, CI-gated
2. **Base Sepolia v2** — active, E2E-proven
3. **Ethereum Sepolia v2** — active, E2E-proven
4. **BNB Chain Testnet v2** — active, E2E-proven
5. **Polygon Amoy v2** — active, E2E-proven

**Verdict:** The relayer is **structurally capable** of operating across all five chains, but has **critical gaps** in config consistency, TypeScript compilation, double-submission protection, and test coverage. It is **not yet runtime-hardened** for multi-chain production.

**Broad code changes were intentionally avoided.** Only `docs/fixes/PR-009-multichain-relayer-readiness.md` and `relayer/.env.example` (documentation-only) were modified.

---

## 2. Active Chain Matrix

| Chain | Family | Chain ID | Domain ID | Domain Hex | Status | Contract Deployed | E2E Proven | Explorer Verified |
|-------|--------|----------|-----------|------------|--------|-------------------|------------|-------------------|
| Solana Devnet | Solana | — | 16777218 | 0x01000002 | Active | ✅ | ✅ Deposit only | N/A |
| Base Sepolia | EVM | 84532 | 33554434 | 0x02000002 | Active | ✅ | ✅ | ✅ |
| Ethereum Sepolia | EVM | 11155111 | 33554435 | 0x02000003 | Active | ✅ | ✅ | ✅ |
| BNB Chain Testnet | EVM | 97 | 33554438 | 0x02000006 | Active | ✅ | ✅ | ✅ |
| Polygon Amoy | EVM | 80002 | 33554436 | 0x02000004 | Active | ✅ | ✅ | ✅ |

**Removed from scope:** Polygon zkEVM Cardona and Polygon zkEVM Mainnet were removed in the preceding commit.

---

## 3. Relayer Config Matrix

### 3.1 Per-Chain Config Coverage

| Check | Solana | Base Sepolia | Ethereum Sepolia | BNB Testnet | Polygon Amoy |
|-------|--------|--------------|------------------|-------------|--------------|
| `networks.json` entry | N/A (EVM-only) | ✅ | ✅ | ✅ | ✅ |
| Deployment artifact | Hardcoded | ✅ | ✅ | ✅ | ✅ |
| `domains.ts` match | ✅ | ✅ | ✅ | ✅ | ✅ |
| App `SupportedChain` | ✅ | ✅ | ✅ | ✅ | ✅ |
| App `CHAINS` map | ✅ | ✅ | ✅ | ✅ | ✅ |
| App contract config | Hardcoded | ✅ | ✅ | ✅ | ✅ |
| Relayer `.env.example` RPC | `RPC_ENDPOINT` | ⚠️ Name mismatch | ⚠️ Name mismatch | ⚠️ Name mismatch | ✅ |
| Relayer `.env.example` protocol | `PROGRAM_ID` | `BASE_PROTOCOL_ADDRESS` | `ETH_PROTOCOL_ADDRESS` | `BSC_PROTOCOL_ADDRESS` | `POLYGON_AMOY_PROTOCOL_ADDRESS` |
| Relayer `.env.example` key | `SEQUENCER_WALLET` | `BASE_DEPLOYER_PRIVATE_KEY` | `ETH_DEPLOYER_PRIVATE_KEY` | `BSC_DEPLOYER_PRIVATE_KEY` | `POLYGON_AMOY_DEPLOYER_PRIVATE_KEY` |
| `render.yaml` RPC | `RPC_ENDPOINT` | `BASE_RPC_URL` | `ETH_RPC_URL` | `BSC_RPC_URL` | `POLYGON_AMOY_RPC_URL` |
| `render.yaml` protocol | `PROGRAM_ID` | `BASE_PROTOCOL_ADDRESS` | `ETH_PROTOCOL_ADDRESS` | `BSC_PROTOCOL_ADDRESS` | `POLYGON_AMOY_PROTOCOL_ADDRESS` |

### 3.2 Critical Finding: RPC Env Var Name Mismatch (HIGH)

`relayer/src/config.ts:getRpcUrl()` reads the env var name from `networks.json`'s `rpcUrlEnvVar` field. However, `.env.example` and `render.yaml` use **different names** for three chains:

| Chain | `networks.json` expects | `.env.example` / `render.yaml` provide | `relayer/src/index.ts` hardcodes |
|-------|------------------------|----------------------------------------|----------------------------------|
| Base Sepolia | `BASE_SEPOLIA_RPC_URL` | `BASE_RPC_URL` | `BASE_RPC_URL` |
| Ethereum Sepolia | `ETHEREUM_SEPOLIA_RPC_URL` | `ETH_RPC_URL` | `ETH_RPC_URL` |
| BNB Chain Testnet | `BSC_TESTNET_RPC_URL` | `BSC_RPC_URL` | `BSC_RPC_URL` |
| Polygon Amoy | `POLYGON_AMOY_RPC_URL` | `POLYGON_AMOY_RPC_URL` | *(none)* |

**Impact:** `getEvmChainContexts()` will **throw** for Base, Ethereum, and BNB when looking up RPC URLs because the env var names don't match. The relayer falls back to hardcoded `baseRpcUrl`, `bscRpcUrl`, `ethRpcUrl` fields in `main()`, but those fields are **unused** by the multi-chain init path. Only Polygon Amoy initializes cleanly via the dynamic loader.

**Fix:** Align `.env.example`, `render.yaml`, and `relayer/src/index.ts` with `networks.json` env var names, OR make `getRpcUrl()` support aliases.

### 3.3 Finding: Cross-Chain Address Collision (MEDIUM)

BNB Chain Testnet and Polygon Amoy share **identical addresses** for all 5 core contracts:

| Contract | BNB Testnet | Polygon Amoy |
|----------|-------------|--------------|
| WhiteProtocol | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` |
| AssetRegistry | `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee` | `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee` |
| DepositVerifier | `0x20Ac5c909E68DA414204309f077c25B70F3eD441` | `0x20Ac5c909E68DA414204309f077c25B70F3eD441` |
| WithdrawVerifier | `0x86CD177aCEc02cAF9cC27874bb0AC6Bb90FA61b6` | `0x86CD177aCEc02cAF9cC27874bb0AC6Bb90FA61b6` |
| MerkleBatchVerifier | `0x0eb44c154DF83876fB44042e822e3373Fbf57d95` | `0x0eb44c154DF83876fB44042e822e3373Fbf57d95` |

This is theoretically possible with CREATE2 deterministic deployment (same deployer, same nonce/salt, same initcode on different chains), but should be explicitly verified on-chain.

---

## 4. EVM Sequencer Readiness

### 4.1 Adapter Initialization

`relayer/src/index.ts:261-281` dynamically loads all `isLive=true` networks from `networks.json` via `getEvmChainContexts()`. ✅ **Not hardcoded to Base.**

**Issue:** All chains share the **same deployer private key** (`config.baseDeployerPrivateKey`). There is no per-chain deployer key support in the multi-chain init path.

### 4.2 Multi-Chain Sequencer

`relayer/src/sequencer/multi-chain.ts` supports all 4 EVM chains simultaneously. ✅

Poll intervals:
| Chain | Interval | Status |
|-------|----------|--------|
| Base Sepolia (84532) | 10s | ✅ |
| Ethereum Sepolia (11155111) | 60s | ✅ |
| Polygon Amoy (80002) | 10s | ✅ |
| BNB Testnet (97) | 30s (fallback) | ⚠️ Not tuned for 3s block time |

### 4.3 EVM Adapter Capabilities (`chains/evm.ts`)

| Capability | Status | Notes |
|------------|--------|-------|
| Read current root | ✅ | `getPoolState()` |
| Read pending commitments | ✅ | `getPendingDeposits()` |
| Read nextLeafIndex | ✅ | `getPoolState()` |
| Submit settlement tx | ✅ | `submitSettlement()` |
| Submit withdrawal tx | ✅ | `submitWithdrawal()` / `withdrawStealth` |
| Correct deployment artifact | ✅ | Injected via constructor |
| v2 asset IDs / domain metadata | ⚠️ | Deployment JSONs contain v2 metadata; adapter doesn't validate them |
| Non-empty tree state | ✅ | `getPoolState()` works regardless of size |
| Chain-specific gas/RPC | ⚠️ | viem handles chain primitives; no explicit gas overrides for BNB legacy gas or Polygon spikes |
| Hardcoded Base addresses | ✅ | Fully generic |
| Retry on settlement | ❌ | `submitSettlement` is **not** wrapped in `withRetry` |
| Circuit breaker on settlement | ❌ | Only Solana has a circuit breaker |
| Double-submit protection | ❌ | **No in-flight settlement tracking** |
| State persistence | ✅ | Per-chain `{chainName}-merkle-state.json`, `{chainName}-pending-state.json` |
| Root verification before submit | ✅ | `localRoot === poolState.currentRoot` check in `tick()` |
| Failed tx handling | ⚠️ | Error caught, loop sleeps, but no reverted-tx detection |

### 4.4 Critical: Double-Submission Risk

`sequencer/evm.ts:tick()` (lines 91-174):
1. Reads `nextLeafIndex` from chain
2. Generates proof
3. Submits settlement
4. Only **after** successful submission updates local state

**There is NO in-flight settlement tracking.** If a settlement tx is pending (not yet mined), the next tick will see the same `nextLeafIndex` and pending deposit, and **submit a second proof for the same deposit.**

### 4.5 High: Event Scanning from Block 0

`startEvmSequencers()` sets **all deployment blocks to `0n`**:
```typescript
const deploymentBlocks = new Map<string, bigint>();
for (const [name, adapter] of this.evmAdapters) {
  deploymentBlocks.set(name, 0n);
}
```

When `syncTreeFromEvents()` triggers (on root mismatch), it scans from block 0 to current in 5000-block chunks. This is extremely RPC-intensive.

### 4.6 Dead Code

- `chains/base.ts` — hardcoded Base Sepolia adapter, **not imported** by `index.ts`
- `base-sequencer.ts` — hardcoded Base sequencer, **not instantiated** by `RelayerService`
- Legacy `base-*` config fields in `RelayerConfig` interface and `main()`

---

## 5. Solana Adapter Readiness

| Component | Status | Evidence |
|-----------|--------|----------|
| `SolanaAdapter` class (`chains/solana.ts`) | 🔴 **Stubbed / Orphaned** | `submitWithdrawal` throws "not yet implemented"; `getMerkleRoot` throws "not yet implemented". Class is **not imported** by `index.ts`. |
| Solana withdrawal (v1) | 🟢 **Functional** | Implemented directly in `RelayerService.submitWithdrawal()` (index.ts:1195-1350) with full PDA derivation, ATA creation, and `sendAndConfirmTransaction`. |
| Solana withdrawal (v2) | 🟢 **Functional** | Implemented directly in `RelayerService.submitWithdrawalV2()` (index.ts:1355-1388). |
| Settlement sequencer | 🟢 **Functional** | `sequencer.ts:tick()` → `apiExtensions.settlePendingDeposits()` with ComputeBudget and priority fees. |
| Pending buffer polling | 🟢 **Functional** | `sequencer.ts:runLoop()` sleeps 30s, calls `tick()`. |
| Proof generation | 🟢 **Functional** | `api-extensions.ts` loads `.wasm`, `.zkey`, `_vk.json` for all circuits. |
| Root/state reconciliation | 🟢 **Functional** | `syncMerkleTree()` parses on-chain `MerkleTreeV2` account; `recoverMerkleTreeFromEvents()` scans historical Anchor events. |
| Nullifier status check | 🟢 **Functional** | `checkNullifierSpent()` with in-memory `NullifierCache` + RPC fallback. |
| Relayer fee validation | 🟡 **Partial** | Fee calculated locally (`feeBps`); **not validated against on-chain `RelayerRegistry` bounds** before processing. |
| Retry/idempotency | 🟢 **Functional** | `submitWithdrawalWithRetry` uses `CircuitBreaker` + `withRetry` with non-retryable error patterns. |
| Devnet program ID | ✅ | `C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW` matches source. |
| Real VK/proof paths | ✅ | Configurable `circuitsPath` with fallback; VK structure validated on load. |

**Bottom line:** The `SolanaAdapter` file is dead code, but the relayer operates successfully without it. Solana is **functional** for withdrawals and settlement.

---

## 6. API Readiness

### 6.1 Routes

| Route | Method | Status |
|-------|--------|--------|
| `/health` | GET | ✅ |
| `/status` | GET | ✅ |
| `/metrics` | GET | ✅ |
| `/quote` | GET | ✅ |
| `/withdraw` | POST | ✅ |
| `/assets` | GET | ✅ |
| `/api/*` | Mixed | ✅ (auth-gated where needed) |

### 6.2 Chain Parameter Validation

**Finding: WEAK**

`processWithdrawal` (index.ts:540):
```typescript
if (request.chain !== 'solana') {
  const network = request.chain === 'base' ? 'base-sepolia' : (request.chain || 'base-sepolia');
  return this.processBaseWithdrawal(request, network);
}
```

- Does **not** validate against `isLive` flag or `getLiveNetworks()`.
- Any string other than `'solana'` is passed to EVM adapter lookup.
- Missing `chain` defaults to `base-sepolia` (legacy behavior).

### 6.3 Quote/Fee Per Chain

**Finding: INCORRECT — global flat fee**

```typescript
calculateFee(amount: bigint): bigint {
  return (amount * BigInt(this.config.feeBps)) / BigInt(10000);
}
```

Same `feeBps` applied to all chains. No gas-aware differentiation.

### 6.4 Stealth Ephemeral Pubkey Validation

**Finding: BUG — unreachable stealth path**

Validation (`index.ts:1058-1070`) requires 66 hex chars (33 bytes compressed secp256k1). ✅

But submission (`index.ts:1296`) checks:
```typescript
if (params.ephemeralPubkey && params.ephemeralPubkey.length === 32) {
```

A valid 33-byte `Uint8Array` has `length === 33`, not `32`. The stealth withdrawal branch is **never executed** for valid ephemerals.

### 6.5 Solana Recipient Validation

**Finding: GOOD**

EVM branch uses `/^0x[a-fA-F0-9]{40}$/`. Solana branch uses `new PublicKey()` with try/catch. Correctly distinguished.

### 6.6 Secret/Nullifier Leakage

**Finding: SAFE**

- `secret` and `nullifier` preimages are **never** logged.
- `nullifierHash` is truncated to 20 chars in info logs.
- Full nullifier hash hex logged **only on error**.

### 6.7 Rate Limiting & Abuse Protection

**Finding: GOOD**

- Global: 500 req/min per IP
- Per-key: 30 req/min (key = `recipient` for `/withdraw`, else `req.ip`)
- Helmet security headers
- CORS restricted to `CORS_ORIGIN`
- JSON body limit: 1MB
- Auth token required for state-mutating `/api/*` endpoints

---

## 7. Env/Secrets Readiness

### 7.1 Required vs Present

| Chain | RPC env | Protocol addr env | Relayer key env | In `.env.example` | In `render.yaml` | Status |
|-------|---------|-------------------|-----------------|-------------------|------------------|--------|
| Solana Devnet | `RPC_ENDPOINT` | `PROGRAM_ID` | `SEQUENCER_WALLET` | ✅ | ✅ | ✅ |
| Base Sepolia | `BASE_SEPOLIA_RPC_URL`¹ | `BASE_PROTOCOL_ADDRESS` | `BASE_DEPLOYER_PRIVATE_KEY` | ⚠️ Name mismatch | ⚠️ Name mismatch | 🔴 |
| Ethereum Sepolia | `ETHEREUM_SEPOLIA_RPC_URL`¹ | `ETH_PROTOCOL_ADDRESS` | `ETH_DEPLOYER_PRIVATE_KEY` | ⚠️ Name mismatch | ⚠️ Name mismatch | 🔴 |
| BNB Testnet | `BSC_TESTNET_RPC_URL`¹ | `BSC_PROTOCOL_ADDRESS` | `BSC_DEPLOYER_PRIVATE_KEY` | ⚠️ Name mismatch | ⚠️ Name mismatch | 🔴 |
| Polygon Amoy | `POLYGON_AMOY_RPC_URL` | `POLYGON_AMOY_PROTOCOL_ADDRESS` | `POLYGON_AMOY_DEPLOYER_PRIVATE_KEY` | ✅ | ✅ | ✅ |

¹ Names expected by `networks.json` / `config.ts:getRpcUrl()`. `.env.example` and `render.yaml` use shorter names.

### 7.2 Missing from `render.yaml`

- Stealth scanner env vars (`STEALTH_SCANNER_POLL_INTERVAL_MS`, `STEALTH_SCANNER_BATCH_SIZE`, `STEALTH_SOLANA_RPC_URL`, `STEALTH_BASE_RPC_URL`, `STEALTH_META_ADDRESS_VERSION`)
- `POLYGON_AMOY_DEPLOYER_PRIVATE_KEY` in secrets comment
- `BSC_DEPLOYER_PRIVATE_KEY` in secrets comment
- `ETH_DEPLOYER_PRIVATE_KEY` in secrets comment

---

## 8. Deployment/Runtime Readiness

### 8.1 Single Process Multi-Chain

**Yes.** `RelayerService` initializes:
- One `MultiChainSequencer` for all live EVM chains
- One `Sequencer` for Solana
- All in a single Node.js process

### 8.2 Enable/Disable

Chains are enabled/disabled via `networks.json` `isLive` flag. `getEvmChainContexts()` only returns `isLive=true` networks. ✅

### 8.3 Filesystem State

**Yes.** Per-chain state files:
- `{chainName}-merkle-state.json`
- `{chainName}-pending-state.json`
- `{chainName}-settled-commitments.json`
- `relayer-state.json`

Writes are atomic (temp file + rename). ✅

### 8.4 Restart Behavior

On restart:
1. Relayer loads persisted tree state from JSON
2. Verifies local root against on-chain root
3. If mismatch, triggers `syncTreeFromEvents()` (scans from block 0 — inefficient)
4. Resumes pending deposits

**No lock file.** Multiple instances could race on state files.

### 8.5 Dockerfile

Production-ready multi-stage build:
- Node 18.20-slim
- Non-root `node` user
- Healthcheck: `GET /health` every 30s
- Copies circuit artifacts

### 8.6 Build Health

**❌ Broken.** `npx tsc --noEmit` fails with 2 errors:
1. `src/chains/solana.ts:29` — `AnchorWallet` not assignable to `Wallet`
2. `src/index.ts:1932` — `bscRpcUrl` does not exist in `RelayerConfig` type

---

## 9. Test Coverage

**Finding: ZERO tests in relayer.**

| Area | Tests Exist? | Real/Mocked | Covers Active Chains? | Missing |
|------|-------------|-------------|----------------------|---------|
| EVM adapter unit tests | ❌ No | N/A | N/A | `submitWithdrawal`, `isSpent`, `getPoolState`, `submitSettlement`, event pagination |
| Solana adapter unit tests | ❌ No | N/A | N/A | `SolanaAdapter` is a stub anyway |
| API / integration tests | ❌ No | N/A | N/A | `/health`, `/status`, `/quote`, `/withdraw`, `/assets`, `/api/*` |
| Sequencer tests | ❌ No | N/A | N/A | `tick()` logic, double-submit protection, root mismatch handling |
| Retry / idempotency tests | ❌ No | N/A | N/A | `withRetry`, `CircuitBreaker` |
| Multi-chain config tests | ❌ No | N/A | N/A | `getEvmChainContexts()`, `getRpcUrl()`, `loadNetwork()` |
| Env validation tests | ❌ No | N/A | N/A | `main()` env parsing |

`relayer/package.json` declares `"test": "jest"`, but **jest is not in dependencies** and no test files exist.

---

## 10. Risk Classification

| Risk | Severity | Evidence | Recommended PR |
|------|----------|----------|----------------|
| RPC env var name mismatch breaks 3 of 4 EVM chains | **CRITICAL** | `config.ts:getRpcUrl()` expects `BASE_SEPOLIA_RPC_URL`; `.env.example` provides `BASE_RPC_URL` | PR-009B |
| TypeScript compilation errors prevent build | **CRITICAL** | `tsc --noEmit` fails on `solana.ts:29` and `index.ts:1932` | PR-009B |
| EVM sequencer double-submits settlements | **CRITICAL** | No in-flight tx tracking; next tick re-submits same proof | PR-009C |
| EVM settlement has no retry or circuit breaker | **HIGH** | `submitSettlement` not wrapped in `withRetry`; no CB | PR-009C |
| EVM event scanning from block 0 | **HIGH** | `deploymentBlocks` initialized to `0n` for all chains | PR-009C |
| Relayer has zero test coverage | **HIGH** | No `.test.ts` files; jest not installed | PR-009E |
| Stealth withdrawal path unreachable | **MEDIUM** | `ephemeralPubkey.length === 32` check never true for valid 33-byte keys | PR-009C |
| Chain parameter not validated against live list | **MEDIUM** | `/withdraw` accepts any non-solana string | PR-009F |
| Flat fee model — no per-chain gas awareness | **MEDIUM** | `calculateFee` uses global `feeBps` | PR-009F |
| No lock file — multiple instances race on state | **MEDIUM** | Atomic writes but no instance-level locking | PR-009E |
| Solana relayer fee not validated on-chain | **LOW** | Relayer does not check `RelayerRegistry` bounds | PR-009D |
| Dead code (`BaseAdapter`, `base-sequencer.ts`) | **LOW** | Not imported by runtime, but maintained | PR-009B |
| `/api/compute-asset-id` only supports v1 | **LOW** | Calls `computeAssetId()` (v1 alias); no v2 endpoint | PR-009F |

---

## 11. Recommended Fix Order

### PR-009B: Relayer Env/Config Validation and Cleanup
1. Fix TypeScript compilation errors (`solana.ts` type mismatch, `RelayerConfig` interface)
2. Align RPC env var names across `networks.json`, `.env.example`, `render.yaml`, and `index.ts`
3. Remove dead code: `BaseAdapter`, `base-sequencer.ts`, legacy `base*` config fields
4. Add per-chain deployer key support to `getEvmChainContexts()` / `EvmAdapter`
5. Add missing stealth scanner env vars to `render.yaml`

### PR-009C: EVM Relayer Multi-Chain Runtime Hardening
1. Add in-flight settlement tracking to `EvmSequencer` (track txHash/nonce, skip tick while pending)
2. Wrap `submitSettlement` in `withRetry` and add per-chain circuit breaker
3. Add deployment block numbers to deployment JSONs or `networks.json`; pass to `MultiChainSequencer`
4. Fix stealth withdrawal length check (`=== 32` → `=== 33`)
5. Add BSC Testnet poll interval (`97: 15000`)
6. Add chain-specific gas tuning for BNB legacy gas and Polygon spikes

### PR-009D: Solana Relayer Adapter Cleanup
1. Either delete `SolanaAdapter` stub or implement it and wire into `index.ts`
2. Add on-chain relayer registry fee bound validation before processing withdrawals
3. Unify Solana SDK usage (relayer reimplements SDK functions inline)

### PR-009E: Relayer Persistence, Idempotency, and Tests
1. Add file-based or memory-based lock to prevent multi-instance state races
2. Add jest/vitest to `devDependencies`
3. Write unit tests for `withRetry`, `CircuitBreaker`, `state-store.ts`
4. Write integration tests for `EvmAdapter` (mocked viem)
5. Write sequencer tick-loop tests with mocked chain state

### PR-009F: API Hardening and Chain Gating
1. Validate `chain` parameter against `getLiveNetworks()` whitelist
2. Remove legacy default to `base-sepolia` when `chain` is omitted
3. Add per-chain quote/fee endpoint (gas-aware)
4. Add `POST /api/compute-asset-id-v2` endpoint
5. Add chain-specific API response labels (`chainId`, `domainId`)

### Then: Bridge Audit/Fixes
After PR-009B–009F are complete and all active chains are runtime-hardened.

---

## 12. Public Claims Safety

| Claim | Safe? | Notes |
|-------|-------|-------|
| "Multi-chain privacy protocol" | ⚠️ Qualify | 5 chains configured, but relayer has critical runtime gaps |
| "Solana Devnet support" | ✅ Safe | Functional deposit + withdrawal |
| "Base Sepolia support" | ✅ Safe | Full E2E proven |
| "Ethereum Sepolia support" | ✅ Safe | Full E2E proven |
| "BNB Chain Testnet support" | ✅ Safe | Full E2E proven |
| "Polygon Amoy support" | ✅ Safe | Full E2E proven |
| "Production-ready" | ❌ Unsafe | Testnets only; zero relayer tests; build errors; double-submit risk |
| "Stealth withdrawals on EVM" | ⚠️ Qualify | Code exists but stealth path is unreachable due to length bug |
| "Relayer supports multi-chain" | ⚠️ Qualify | Structurally yes, but env mismatches break 3 of 4 EVM chains |

---

## 13. Final Verdict

**Is the relayer ready to operate across all active chains for non-bridge privacy flows?**

**No — not yet.**

The relayer is **architecturally sound** and **structurally capable** of operating across Solana, Base Sepolia, Ethereum Sepolia, BNB Chain Testnet, and Polygon Amoy. All required code paths exist, and all five chains have working deployments.

However, **three critical blockers** prevent safe multi-chain operation:

1. **Config mismatch:** RPC env var names differ between `networks.json` and `.env.example`/`render.yaml`, which will cause runtime failures for Base, Ethereum, and BNB.
2. **Build failure:** Two TypeScript compilation errors prevent `tsc` from producing a clean build.
3. **Double-submission risk:** The EVM sequencer has no in-flight settlement tracking, meaning it can submit duplicate batch proofs.

Once PR-009B (config/build cleanup) and PR-009C (EVM runtime hardening) are complete, the relayer will be ready for multi-chain testnet operation.

---

## 14. Next Implementation PR

**PR-009B: Relayer Env/Config Validation and Cleanup**

- Smallest, safest set of changes
- Unblocks all other fixes
- No runtime logic changes (only config alignment, type fixes, dead code removal)
- Expected: ~5 files changed, ~50 lines modified
