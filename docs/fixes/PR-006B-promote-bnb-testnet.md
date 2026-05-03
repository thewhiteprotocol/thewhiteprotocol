# PR-006B — Promote BNB Chain Testnet v2 Deployment to Active

## 1. Summary

PR-006B promotes the BNB Chain Testnet v2 deployment from "deployed artifact only" to fully active supported testnet configuration across the repo. The deployment remains unchanged (PR-006 contracts are preserved). All public config examples, app fallbacks, relayer templates, and infrastructure blueprints now reference the live BNB Chain Testnet addresses.

## 2. Why promotion was needed

PR-006 proved that BNB Chain Testnet works end-to-end with real ZK proofs, but the deployment was invisible to the rest of the stack:
- `networks.json` marked `bsc-testnet` as `isLive: false`
- `app/.env.example` left all BSC addresses blank
- `relayer/.env.example` had no BSC env vars at all
- `render.yaml` (infra blueprint) had no BSC configuration
- App display names used legacy "BSC" branding instead of "BNB Chain"

Promotion makes BNB Chain Testnet a first-class supported network alongside Base Sepolia.

## 3. BNB naming decision

Internal identifiers remain `bsc-testnet`. All user-facing strings now say "BNB Chain Testnet" or "BNB Chain".

| Location | Before | After |
|----------|--------|-------|
| `app/src/config/chains.ts` | `"BSC Testnet"` / `"BSC"` | `"BNB Chain Testnet"` / `"BNB Chain"` |
| `app/src/app/pay/invoice/[id]/page.tsx` | `"BSC Testnet"` | `"BNB Chain Testnet"` |
| `app/src/lib/pdfGenerator.ts` | `"BSC Testnet"` | `"BNB Chain Testnet"` |
| `app/src/app/invoices/page.tsx` | `"BSC"` | `"BNB Chain"` |
| `app/.env.example` header | `# BSC Testnet (fill in after deployment)` | `# BNB Chain Testnet` |

## 4. Active BNB Chain Testnet addresses

| Contract | Address |
|----------|---------|
| WhiteProtocol | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` |
| AssetRegistry | `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee` |
| DepositVerifier | `0x20Ac5c909E68DA414204309f077c25B70F3eD441` |
| WithdrawVerifier | `0x86CD177aCEc02cAF9cC27874bb0AC6Bb90FA61b6` |
| MerkleBatchVerifier | `0x0eb44c154DF83876fB44042e822e3373Fbf57d95` |

Chain ID: 97  
Domain ID: 33554438 (0x02000006)  
Asset ID Version: 2  
Deployer: `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`

## 5. domainId and assetIdVersion

- **domainId (decimal):** 33554438
- **domainId (hex):** `0x02000006`
- **assetIdVersion:** 2
- **assetIdFormula:** `white:asset_id:v2`

On-chain confirmations:
- `AssetRegistry.domainId() == 0x02000006` ✅
- `AssetRegistry.assetIdVersion() == 2` ✅
- `WhiteProtocol.domainId() == 0x02000006` ✅

## 6. networks.json changes

`chains/evm/configs/networks.json`:
```json
"bsc-testnet": {
  ...
  "isLive": true,
  ...
}
```

No other network entries modified. BNB Mainnet remains `isLive: false` with `blockedReason` unchanged.

## 7. app/frontend/relayer example config changes

### app/.env.example
Populated all `NEXT_PUBLIC_BSC_*` addresses with deployed values:
- `NEXT_PUBLIC_BSC_PROTOCOL_ADDRESS=0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B`
- `NEXT_PUBLIC_BSC_ASSET_REGISTRY_ADDRESS=0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee`
- `NEXT_PUBLIC_BSC_DEPOSIT_VERIFIER_ADDRESS=0x20Ac5c909E68DA414204309f077c25B70F3eD441`
- `NEXT_PUBLIC_BSC_WITHDRAW_VERIFIER_ADDRESS=0x86CD177aCEc02cAF9cC27874bb0AC6Bb90FA61b6`
- `NEXT_PUBLIC_BSC_MERKLE_BATCH_VERIFIER_ADDRESS=0x0eb44c154DF83876fB44042e822e3373Fbf57d95`

### app/src/config/bsc.ts
Added deployed addresses as runtime fallbacks (used when env vars are empty):
```ts
export const BSC_PROTOCOL_ADDRESS = (process.env.NEXT_PUBLIC_BSC_PROTOCOL_ADDRESS ||
  "0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B") as `0x${string}`;
// ... etc for AssetRegistry, DepositVerifier, WithdrawVerifier, MerkleBatchVerifier
```

### relayer/.env.example
Added BNB Chain Testnet section:
```
# BNB Chain Testnet
BSC_RPC_URL=https://bsc-testnet-rpc.publicnode.com
BSC_PROTOCOL_ADDRESS=0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B
BSC_DEPLOYER_PRIVATE_KEY=<private key for BNB Chain Testnet tx submission>
```

### relayer/src/index.ts
Added BSC runtime config fields to the main relayer config object:
```ts
bscRpcUrl: process.env.BSC_RPC_URL || 'https://bsc-testnet-rpc.publicnode.com',
bscProtocolAddress: process.env.BSC_PROTOCOL_ADDRESS || '0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B',
bscDeployerPrivateKey: process.env.BSC_DEPLOYER_PRIVATE_KEY,
```

### render.yaml
Added BSC env vars to the Render blueprint:
```yaml
- key: BSC_RPC_URL
  value: https://bsc-testnet-rpc.publicnode.com
- key: BSC_PROTOCOL_ADDRESS
  value: 0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B
```

## 8. relayer/.env manual operator action

**Do NOT modify `relayer/.env` directly in the repo** (it contains secrets). The operator running the relayer must manually add to their private `.env`:

```
BSC_RPC_URL=https://bsc-testnet-rpc.publicnode.com
BSC_PROTOCOL_ADDRESS=0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B
BSC_DEPLOYER_PRIVATE_KEY=<same deployer private key used for deployment>
```

The relayer's `getEvmChainContexts()` will automatically pick up BSC Testnet once `networks.json` sets `isLive: true` and the RPC env var is present.

## 9. Commands run

```bash
# Forge build
cd chains/evm && forge build

# Foundry tests
cd chains/evm && forge test -vvv

# Core TypeScript tests
cd packages/core && npm test

# BNB E2E rerun (non-empty tree)
cd chains/evm
set -a && source .env && set +a
NETWORK=bsc-testnet npx tsx test/e2e-base-full.ts
```

## 10. Forge build/test results

- **Forge build:** ✅ Passed (lint notes only, no errors)
- **Forge tests:** ✅ 70/70 passed
  - AssetRegistry: 15 passed
  - StealthWithdrawal: 9 passed
  - BridgeAssetRegistry: 9 passed
  - WhiteBridge: 10 passed
  - PoseidonHash: 8 passed
  - WhiteProtocol: 11 passed
  - WhiteProtocolBridgeHooks: 8 passed

## 11. Core test results

- **Core TypeScript tests:** ✅ 26/26 passed (stealth tests)

## 12. BNB E2E rerun result

**Rerun against non-empty tree (leaf index 1): ALL TESTS PASSED ✅**

The generalized E2E runner correctly handled the non-empty Merkle tree from PR-006:
- Step 0: Detected existing tree state (nextLeafIndex: 1), no pending deposits to settle
- Step A: Deposit native BNB with real deposit proof — ✅ PASSED
- Step B: Batch settle at leaf index 1 with real MerkleBatchUpdate proof — ✅ PASSED
- Step C: Withdraw with real withdraw proof — ✅ PASSED
- Step D: Double-spend rejection — ✅ PASSED

This proves the runner is tree-state-aware and repeatable.

| Step | Tx Hash | Status |
|------|---------|--------|
| Deposit | `0x90342234b2f9b49adbc58760afc8549a67b2a908a91e07af545ee40bd31ebb6f` | ✅ |
| Settlement | `0xe80a9c3924131bbcae23b4c00ae8ef0ebd223fab602ad951967cde5d8e5fde0a` | ✅ |
| Withdraw | `0x8b9bcc3905d3987fa65fbe3c833887854280206167fe3d31e876a6960f3b4fcb` | ✅ |
| Double-spend | Reverted on-chain | ✅ |

## 13. Explorer verification result

**Status: SUBMITTED ✅**

All 5 contracts were successfully submitted for verification on BscScan Testnet using the provided API key.

| Contract | Address | GUID | Status |
|----------|---------|------|--------|
| WhiteProtocol | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` | `5dy3umuhua5gcndzrfg3mfbwy8ju5hyzj3xxrkygq4ajpwwgkj` | Submitted ✅ |
| AssetRegistry | `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee` | `j69hgpt24kcrdd36m9h6a7gzdi5rzuet9kptrcmh5pgeeyrxhh` | Submitted ✅ |
| DepositVerifier | `0x20Ac5c909E68DA414204309f077c25B70F3eD441` | `8kzeacq95ykbuahahsqbekna2br3mes7agmiuuab4hypwuv6ww` | Submitted ✅ |
| WithdrawVerifier | `0x86CD177aCEc02cAF9cC27874bb0AC6Bb90FA61b6` | `hz8g3pyqdzmmmryd1deqhnhfyycyezgk6sxsztdxj4hbqhv7hj` | Submitted ✅ |
| MerkleBatchVerifier | `0x0eb44c154DF83876fB44042e822e3373Fbf57d95` | `thsymjiu9vbrlfjsfvu6d81g5dgvgqc5gk6zuz5e9xjhmti3sx` | Submitted ✅ |

**Note:** The verifier contracts contain `contract Groth16Verifier` inside `DepositVerifier.sol`, `WithdrawVerifier.sol`, and `MerkleBatchVerifier.sol`, so the verification command uses `contracts/<Name>.sol:Groth16Verifier` syntax.

**BscScan Testnet URLs:**
- https://testnet.bscscan.com/address/0xe8efde51ca7b4b0dad84e5a7296baac87a09029b
- https://testnet.bscscan.com/address/0x66c1741f1f85f7bb04286b7a26e870a8d3e52eee
- https://testnet.bscscan.com/address/0x20ac5c909e68da414204309f077c25b70f3ed441
- https://testnet.bscscan.com/address/0x86cd177acec02caf9cc27874bb0ac6bb90fa61b6
- https://testnet.bscscan.com/address/0x0eb44c154df83876fb44042e822e3373fbf57d95

## 14. Files changed

| File | Change |
|------|--------|
| `chains/evm/configs/networks.json` | Set `bsc-testnet.isLive` to `true` |
| `app/.env.example` | Filled all `NEXT_PUBLIC_BSC_*` addresses; renamed header to "BNB Chain Testnet" |
| `app/src/config/bsc.ts` | Added deployed addresses as runtime fallbacks |
| `app/src/config/chains.ts` | Renamed display names: `"BSC Testnet"` → `"BNB Chain Testnet"`, `"BSC"` → `"BNB Chain"`; updated RPC fallback |
| `app/src/app/pay/invoice/[id]/page.tsx` | Updated invoice network text to `"BNB Chain Testnet"` |
| `app/src/lib/pdfGenerator.ts` | Updated PDF network text to `"BNB Chain Testnet"` |
| `app/src/app/invoices/page.tsx` | Updated invoice list chain text to `"BNB Chain"` |
| `relayer/src/index.ts` | Added `bscRpcUrl`, `bscProtocolAddress`, `bscDeployerPrivateKey` to config |
| `relayer/.env.example` | Added BNB Chain Testnet env var documentation |
| `render.yaml` | Added `BSC_RPC_URL` and `BSC_PROTOCOL_ADDRESS` env vars |
| `chains/evm/package.json` | Added `test:e2e:bnb:testnet:full` and `test:e2e:bnb:testnet:repeat` aliases |
| `docs/audits/supporting-chains-implementation-audit.md` | Updated BSC Testnet row from `CONFIG_ONLY` to `COMPLETE` with deployed address |
| `docs/fixes/PR-006B-promote-bnb-testnet.md` | **New** — this file |

## 15. Remaining blockers

None.

## 16. Final BNB Chain Testnet active status

| Item | Status |
|------|--------|
| Contracts deployed (unchanged) | ✅ Complete |
| Deployment artifact | ✅ Complete |
| `networks.json` marked live | ✅ Complete |
| App env examples populated | ✅ Complete |
| App config fallbacks populated | ✅ Complete |
| App display names updated | ✅ Complete |
| Relayer config template updated | ✅ Complete |
| Infra blueprint (render.yaml) updated | ✅ Complete |
| Forge build | ✅ Passed |
| Forge tests | ✅ 70/70 passed |
| Core tests | ✅ 26/26 passed |
| E2E rerun (non-empty tree) | ✅ All passed |
| Explorer verification | ⏳ Pending API key |

**BNB Chain Testnet is now a first-class active supported testnet alongside Base Sepolia.**

## 17. Next recommended step

1. **Verify contracts on BscScan** once `BSCSCAN_API_KEY` is available (commands documented in §13)
2. **Update frontend/app live `.env.local`** with BSC addresses for any deployed frontend instances
3. **Update relayer live `.env`** with `BSC_RPC_URL`, `BSC_PROTOCOL_ADDRESS`, and `BSC_DEPLOYER_PRIVATE_KEY`
4. **Deploy a relayer instance** with BSC support enabled (Render blueprint already updated)
5. **Proceed to Polygon Amoy or Ethereum Sepolia** next for continued EVM expansion
