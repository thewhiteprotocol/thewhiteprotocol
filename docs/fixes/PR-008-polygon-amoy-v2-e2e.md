# PR-008 — Polygon Amoy v2 Deployment and E2E

## 1. Summary

PR-008 aims to deploy The White Protocol to **Polygon Amoy** with v2 domain-separated asset IDs and run the full repeatable E2E (deposit → settlement → withdraw → double-spend rejection) using real Groth16 verifiers.

**Current status: BLOCKED — deployer wallet has insufficient POL balance on Polygon Amoy.**

No unsafe deployment was attempted. All pre-deployment checks passed. The generalized E2E runner and deployment script are confirmed compatible with Polygon Amoy.

## 2. Why Polygon Amoy was chosen next

Polygon is one of the five target chains in The White Protocol roadmap:
- Solana (already devnet-proven)
- Ethereum (Sepolia v2 proven — PR-007/007B)
- Base (Sepolia v2 proven — PR-005/005B)
- BNB Chain (Testnet v2 proven — PR-006/006B)
- **Polygon** (Amoy — this PR)

Polygon Amoy is the Polygon PoS testnet. It is the logical next EVM testnet to prove before any mainnet work.

## 3. Naming decision

| Name in Repo | Meaning | Keep/Rename | Reason |
|--------------|---------|-------------|--------|
| `polygon-amoy` | Internal network key in `networks.json`, scripts, artifacts | **Keep** | Already used consistently across `networks.json`, `foundry.toml`, `package.json`, and docs. |
| `Polygon Amoy` | User-facing display name | **Keep** | Standard industry name for the Polygon PoS testnet. |
| `POL` | Native token symbol | **Keep** | Polygon Amoy native token is POL (formerly MATIC). |

No renaming needed. The repo already uses consistent naming.

## 4. Chain config

From `chains/evm/configs/networks.json`:

```json
"polygon-amoy": {
  "chainId": 80002,
  "domainId": 33554436,
  "rpcUrlEnvVar": "POLYGON_AMOY_RPC_URL",
  "explorerUrl": "https://amoy.polygonscan.com",
  "nativeSymbol": "POL",
  "wrappedNative": null,
  "usdc": null,
  "usdt": null,
  "blockTimeSeconds": 2,
  "finalityConfirmations": 5,
  "isTestnet": true,
  "isLive": false,
  "deploymentFile": "deployments/polygon-amoy.json",
  "deployWrappedNativeIfNull": true
}
```

## 5. domainId and assetIdVersion

- **domainId:** `33554436` (`0x02000004`)
- **domainIdHex:** `0x02000004`
- **assetIdVersion:** `2`
- **assetIdFormula:** `white:asset_id:v2`

This matches `ProtocolDomain.POLYGON_AMOY` in `packages/core/src/domains.ts`.

The domain ID structure:
- High byte: `0x02` = EVM family
- Low 3 bytes: `0x000004` = network ID 4

## 6. Deployment result

**No deployment performed.** Blocked by insufficient deployer funds.

## 7. New deployed addresses

**None yet.** Addresses will be captured post-deployment in `chains/evm/deployments/polygon-amoy.json`.

Expected contracts to deploy:
- `WhiteProtocol`
- `AssetRegistry`
- `DepositVerifier` (real Groth16 verifier)
- `WithdrawVerifier` (real Groth16 verifier)
- `MerkleBatchVerifier` (real Groth16 verifier)
- `WrappedNative9` (auto-deployed because `wrappedNative: null` and `deployWrappedNativeIfNull: true`)

## 8. Real verifier confirmation

`Deploy.s.sol` uses `_deployBytecode("DepositVerifier.sol:Groth16Verifier")` and equivalents for all three verifiers. No mocks are used. This is the same pattern proven on Base Sepolia, BNB Chain Testnet, and Ethereum Sepolia.

## 9. Native asset ID

The native asset ID for Polygon Amoy will be:

```
assetId = computeAssetIdV2(address(0), 33554436)
```

Using the v2 formula: `keccak256("white:asset_id:v2" || token_address || domain_id)`

This will be verified against `AssetRegistry.getAssetId(address(0))` post-deployment.

## 10. Wrapped native asset ID

If `WrappedNative9` is auto-deployed, its asset ID will be:

```
assetId = computeAssetIdV2(wrappedNativeAddress, 33554436)
```

The wrapped native address will be captured in the deployment artifact.

## 11. Base-vs-BNB-vs-Ethereum-vs-Polygon asset ID comparison

Pre-computed v2 native asset IDs (all field-safe, high byte = 0x00):

| Chain | Domain ID | Native Asset ID (hex) |
|-------|-----------|----------------------|
| Base Sepolia | 33554434 (0x02000002) | `0x00fb58d8...` |
| Ethereum Sepolia | 33554435 (0x02000003) | `0x002eedb1...` |
| BNB Chain Testnet | 33554438 (0x02000006) | `0x00da3c47...` |
| Polygon Amoy | 33554436 (0x02000004) | *(pending deployment verification)* |

All four are guaranteed distinct because:
1. Domain IDs are unique per chain.
2. The v2 asset ID formula includes `domain_id` in the hash input.
3. All native asset IDs are field-safe (high byte = 0x00).

## 12. Build/test results

### Forge build
```bash
cd chains/evm && forge build
```
**Result:** ✅ Passed (lint notes only, no errors)

### Forge tests
```bash
cd chains/evm && forge test -vvv
```
**Result:** ✅ 70/70 passed

### Core TypeScript tests
```bash
npm test --workspace=@thewhiteprotocol/core
```
**Result:** ✅ 26/26 passed

## 13. E2E result

**Not run.** Blocked by missing deployment.

The E2E runner (`test/e2e-base-full.ts`) is confirmed compatible:
- Reads `NETWORK=polygon-amoy` from env.
- Loads config from `configs/networks.json`.
- Has public fallback RPC: `https://rpc-amoy.polygon.technology`.
- Computes v2 asset IDs using `computeAssetIdV2BigInt`.
- Tree-state aware (reads `filledSubtrees` for any `startIndex`).
- No mock verifiers.

Package scripts added:
- `test:e2e:polygon:amoy:full`
- `test:e2e:polygon:amoy:repeat`

## 14. Deposit evidence

**N/A — deployment blocked.**

## 15. Settlement evidence

**N/A — deployment blocked.**

## 16. Withdraw evidence

**N/A — deployment blocked.**

## 17. Double-spend rejection evidence

**N/A — deployment blocked.**

## 18. Gas summary

**N/A — deployment blocked.**

Estimated gas requirements based on prior EVM deployments:
- **Contract deployments:** ~5–8M gas total
- **Deposit:** ~120k gas
- **Settlement:** ~180k gas
- **Withdraw:** ~220k gas
- **Total E2E cycle:** ~0.5M gas

Current Amoy gas price: ~87 gwei (as of check).
Estimated POL needed for deployment + one E2E cycle: **~1–2 POL**.
Recommended with buffer: **5 POL**.

## 19. Explorer verification result or commands

**Not attempted.** Blocked by missing deployment.

Additionally, `POLYGONSCAN_API_KEY` is present in `.env` but has length 0 (empty string). Even after deployment, explorer verification would fail unless a valid API key is provided.

Post-deployment verify command template:
```bash
cd chains/evm
NETWORK=polygon-amoy forge script script/Deploy.s.sol \
  --ffi --rpc-url $POLYGON_AMOY_RPC_URL --broadcast --verify
```

## 20. Config promotion result

**Not performed.** `isLive` remains `false` in `networks.json` pending successful deployment and E2E.

Post-deployment promotion checklist (to be executed after E2E passes):
- [ ] Set `isLive: true` in `networks.json` for `polygon-amoy`
- [ ] Add Polygon Amoy addresses to `app/.env.example`
- [ ] Add Polygon Amoy env vars to `relayer/.env.example`
- [ ] Add Polygon Amoy to `render.yaml`
- [ ] Create `app/src/config/polygon.ts`
- [ ] Add `"polygon"` to `SupportedChain` union and `CHAINS` map in `app/src/config/chains.ts`
- [ ] Update `docs/audits/supporting-chains-implementation-audit.md`

## 21. Files changed

| File | Change |
|------|--------|
| `chains/evm/package.json` | Added `test:e2e:polygon:amoy:full` and `test:e2e:polygon:amoy:repeat` scripts |
| `docs/fixes/PR-008-polygon-amoy-v2-e2e.md` | **New** — this report |

## 22. Remaining blockers

### Blocker 1: Insufficient deployer funds (CRITICAL)
- **Public address:** `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`
- **Current balance:** `0.0 POL`
- **Estimated needed:** ~1–2 POL for deployment + E2E
- **Recommended:** 5 POL with buffer
- **Faucet options:**
  - https://faucet.polygon.technology/
  - https://amoy.faucet.polygon.technology/ (Alchemy)
  - https://www.alchemy.com/faucets/polygon-amoy

### Blocker 2: Missing POLYGONSCAN_API_KEY (NON-CRITICAL)
- **Impact:** Explorer verification will fail after deployment.
- **Workaround:** Manual verification via Polygonscan UI or post-deployment `forge verify-contract` with a valid key.
- **Does not block:** Deployment or E2E.

## 23. Final Polygon Amoy status

| Item | Status |
|------|--------|
| Config in `networks.json` | ✅ Present |
| `foundry.toml` RPC + etherscan | ✅ Configured |
| `Deploy.s.sol` compatibility | ✅ Confirmed (handles `deployWrappedNativeIfNull`) |
| E2E runner compatibility | ✅ Confirmed (fallback RPC, v2 asset IDs, tree-state aware) |
| Domain ID matches registry | ✅ `33554436` = `0x02000004` |
| assetIdVersion planned | ✅ `2` |
| Real verifiers planned | ✅ Yes (same pattern as Base/BNB/Ethereum) |
| Forge build | ✅ Passed |
| Forge tests | ✅ 70/70 passed |
| Core tests | ✅ 26/26 passed |
| Deployer POL balance | ❌ `0.0 POL` |
| Deployment performed | ❌ Blocked |
| E2E run | ❌ Blocked |
| Explorer verification | ❌ Blocked (no deployment + empty API key) |
| `isLive` promotion | ❌ Blocked |

## 24. Next recommended step

1. **Fund the deployer wallet** with at least 5 POL on Polygon Amoy:
   - Address: `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`
   - Use any Amoy faucet or transfer from a funded wallet.

2. **(Optional) Set a valid `POLYGONSCAN_API_KEY`** in `chains/evm/.env` if explorer verification is desired.

3. **Re-run PR-008** by executing:
   ```bash
   cd chains/evm
   source .env
   NETWORK=polygon-amoy forge script script/Deploy.s.sol --ffi --rpc-url $POLYGON_AMOY_RPC_URL --broadcast --verify
   ```

4. **Run E2E**:
   ```bash
   cd chains/evm
   NETWORK=polygon-amoy tsx test/e2e-base-full.ts
   ```

5. **After E2E passes**, complete the promotion checklist in Section 20.
