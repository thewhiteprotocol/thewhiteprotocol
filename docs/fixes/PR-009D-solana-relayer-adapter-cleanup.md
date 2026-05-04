# PR-009D — Solana Relayer Adapter Cleanup, Fee Validation, and SDK Unification

## 1. Summary

This PR resolves the orphaned `SolanaAdapter` stub, adds on-chain relayer fee validation for Solana withdrawals, centralizes inline PDA derivations, and documents the new behavior. No on-chain programs were modified, no EVM contracts were touched, and existing Solana withdrawal/settlement paths remain functional.

## 2. Starting State from PR-009 Audit

| Finding | Severity | File |
|---------|----------|------|
| `SolanaAdapter` is a dead stub — zero imports across the relayer | Medium | `relayer/src/chains/solana.ts` |
| Relayer fee is calculated locally (`feeBps` config) but never validated against on-chain `RelayerRegistry` bounds | Medium | `relayer/src/index.ts` |
| Solana PDA derivations are duplicated inline in 4+ locations | Low | `relayer/src/index.ts` |
| No env documentation for Solana registry safety override | Low | `relayer/.env.example` |

## 3. Solana Runtime Path Table

| Runtime path | Current file/function | Used? | Action |
|--------------|----------------------|-------|--------|
| Solana withdrawal v1 | `index.ts:processSolanaWithdrawal()` | ✅ Yes | Kept, added fee validation |
| Solana withdrawal v2 | `index.ts:processSolanaWithdrawalV2()` | ✅ Yes | Kept, added fee validation |
| Solana settlement (sequencer) | `sequencer.ts:Sequencer.tick()` | ✅ Yes | Kept, PDA helpers unified |
| Merkle tree sync | `api-extensions.ts:syncMerkleTree()` | ✅ Yes | Unchanged |
| `SolanaAdapter.submitWithdrawal` | `chains/solana.ts` | ❌ No imports | **Removed** |
| `SolanaAdapter.getMerkleRoot` | `chains/solana.ts` | ❌ No imports | **Removed** |
| `SolanaAdapter.initialize` | `chains/solana.ts` | ❌ No imports | **Removed** |

## 4. SolanaAdapter Decision

**Option A — Remove stub** was chosen.

**Evidence:**
```bash
$ grep -rn "SolanaAdapter" relayer/src/
relayer/src/chains/solana.ts:16:export class SolanaAdapter:

$ grep -rn "from '../chains/solana'" relayer/src/
# (no output)

$ grep -rn "from './chains/solana'" relayer/src/
# (no output)
```

The class is defined but never imported or instantiated. The working Solana runtime is fully implemented inline in `RelayerService` (withdrawals) and `Sequencer` / `RelayerApiExtensions` (settlements). Re-implementing an adapter abstraction would require a broad refactor of working code with no immediate benefit. The stub was deleted.

## 5. Relayer Registry Fee Validation Design

### On-chain accounts used

| Account | PDA Seeds | Purpose |
|---------|-----------|---------|
| `RelayerRegistry` | `[b"relayer_registry", pool_config]` | Global fee bounds (`min_fee_bps`, `max_fee_bps`) |
| `RelayerNode` | `[b"relayer", registry, operator]` | Per-relayer config (`fee_bps`, `is_active`) |

### Validation logic (`relayer/src/solana-fee-validator.ts`)

1. Fetch `RelayerRegistry` account data and parse `min_fee_bps`, `max_fee_bps`.
2. Check that `config.feeBps` is within `[min_fee_bps, max_fee_bps]`.
3. Derive and optionally fetch `RelayerNode` for the relayer operator.
4. If node exists:
   - Verify `node.is_active === true`
   - Verify `node.feeBps === config.feeBps`
5. If registry is missing:
   - **Production** (`NODE_ENV=production`): always fail closed
   - **Dev/Test**: allow explicit bypass via `RELAYER_ALLOW_MISSING_SOLANA_REGISTRY=true`

### Integration points

Fee validation is called **before** expensive ZK proof verification in:
- `processSolanaWithdrawal()`
- `processSolanaWithdrawalV2()`

This ensures fast failure if the relayer is misconfigured or deactivated.

## 6. SDK/PDA Helper Unification

### New file: `relayer/src/solana-pdas.ts`

Centralizes all Solana PDA derivations used by the relayer with signatures matching the SDK's `pda.ts`:

- `findMerkleTreePda`
- `findAssetVaultPda`
- `findVaultTokenAccountPda`
- `findSpentNullifierPda`
- `findRelayerRegistryPda`
- `findRelayerNodePda`
- `findYieldRegistryPda`
- `findPendingBufferPda`
- `findWithdrawVkPda`
- `findWithdrawV2VkPda`
- `findMerkleBatchVkPda`

### Inline replacements in `index.ts`

All `PublicKey.findProgramAddressSync` calls were replaced with helpers:

| Location | Previous | Now |
|----------|----------|-----|
| `checkNullifierSpent` | inline `'nullifier'` | `findSpentNullifierPda` |
| `submitWithdrawal` | inline 6 PDAs | helpers |
| `submitWithdrawalV2` | inline 8 PDAs | helpers |
| `start()` (sequencer) | inline 3 PDAs | helpers |

### SDK gap documented

`findMerkleBatchVkPda` uses seed `'vk_merkle_batch'`, which does **not** exist in `@whiteprotocol/sdk` (the SDK's `ProofType` enum lacks a `MerkleBatch` variant). This is left as a known gap; adding it to the SDK is a follow-up task.

## 7. Config/Env Changes

### `relayer/.env.example`

Added section:
```bash
# ── Solana Relayer Registry (optional) ──
# Set to "true" to allow withdrawals when on-chain RelayerRegistry is missing.
# Only for dev/test. In production (NODE_ENV=production) this is ignored and
# the relayer always fails closed if the registry is unavailable.
# RELAYER_ALLOW_MISSING_SOLANA_REGISTRY=false
```

### `render.yaml`

Added commented entry for `RELAYER_ALLOW_MISSING_SOLANA_REGISTRY` under protocol settings.

## 8. Commands Run

```bash
cd relayer && npm run typecheck   # ✅ pass
cd relayer && npm run build       # ✅ pass
cd relayer && npm run validate:config
# ❌ fails only on missing RPC env vars in clean Codespace (expected)
```

## 9. Typecheck/Build/Config Validation Results

| Check | Result | Notes |
|-------|--------|-------|
| `npm run typecheck` | ✅ Pass | No TS errors |
| `npm run build` | ✅ Pass | `tsc && cp -r src/idl dist/` |
| `npm run validate:config` | ⚠️ Expected fail | Missing `BASE_SEPOLIA_RPC_URL`, `ETHEREUM_SEPOLIA_RPC_URL`, `BSC_TESTNET_RPC_URL`, `POLYGON_AMOY_RPC_URL` in clean environment |

## 10. Files Changed

| File | Action |
|------|--------|
| `relayer/src/chains/solana.ts` | **Deleted** (orphaned stub) |
| `relayer/src/solana-pdas.ts` | **Created** (centralized PDA helpers) |
| `relayer/src/solana-fee-validator.ts` | **Created** (registry fee validation) |
| `relayer/src/index.ts` | Modified (use PDA helpers, add fee validation) |
| `relayer/.env.example` | Modified (document `RELAYER_ALLOW_MISSING_SOLANA_REGISTRY`) |
| `render.yaml` | Modified (document `RELAYER_ALLOW_MISSING_SOLANA_REGISTRY`) |

## 11. Remaining Solana Relayer Blockers

1. **SDK dependency not wired**: `@whiteprotocol/sdk` is available in the monorepo but not linked into `node_modules`. To fully unify PDA helpers, the SDK should be added as a workspace dependency and `relayer/src/solana-pdas.ts` should be replaced with SDK imports.
2. **`vk_merkle_batch` seed gap**: The SDK `ProofType` enum does not include a variant for the merkle batch update verification key. This seed is used by the sequencer but is absent from the SDK.
3. **Relayer node fetch is optional**: The fee validator fetches the relayer node but does not require it. If the node is missing, only registry bounds are checked. This matches on-chain behavior (withdrawal handlers accept `relayer_node: Option<...>`), but relayer operators should register their node to benefit from full validation.
4. **No automated tests**: The relayer has zero test coverage. Adding unit tests for `solana-fee-validator.ts` and `solana-pdas.ts` is deferred.

## 12. Next Recommended PR

**PR-009E — Relayer test coverage and SDK wiring**

- Add `@whiteprotocol/sdk` as a relayer dependency and replace `solana-pdas.ts` with SDK imports.
- Add `ProofType.MerkleBatchUpdate` to the SDK and expose `findMerkleBatchVkPda`.
- Write unit tests for `solana-fee-validator.ts` using mocked `Connection`.
- Add integration tests for Solana withdrawal routes (mocked program/Anchor provider).
