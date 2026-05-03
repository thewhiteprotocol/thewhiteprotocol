# PR-007 — Ethereum Sepolia v2 Deployment & E2E

## 1. Summary

PR-007 extends The White Protocol's verified EVM privacy stack to Ethereum Sepolia using v2 domain-separated asset IDs. Deployment, full on-chain E2E, explorer verification, and active testnet promotion are all **complete**.

## 2. Why Ethereum Sepolia was chosen next

- Base Sepolia v2 is already live and E2E-verified (PR-005C/005D/005E).
- BNB Chain Testnet v2 is already live and E2E-verified (PR-006/006B).
- Ethereum is the next-highest priority in the target chain set (Solana, Ethereum, Base, BNB Chain, Polygon).
- Proving cross-domain asset ID separation requires at least three EVM domains with different `domainId`s.
- The repo already contains `ethereum-sepolia` network configuration and deployment script scaffolding.

## 3. Naming decision

| Name in Repo | Meaning | Keep/Rename | Reason |
|--------------|---------|-------------|--------|
| `ethereum-sepolia` | Network key in configs/networks.json, Foundry profiles, package scripts | **Keep** | Internal config key; renaming risks breaking scripts, CI, and existing references |
| `ETHEREUM_SEPOLIA_RPC_URL` | Environment variable name | **Keep** | Matches internal key naming |
| `Ethereum Sepolia` | User-facing / docs language | **Use in docs** | Public product language |
| `ETH` | Native token symbol | **Keep** | Already correct in networks.json |
| `ProtocolDomain.ETHEREUM_SEPOLIA` | TypeScript enum name | **Keep** | Internal code convention |

**Decision:** Internal identifiers remain `ethereum-sepolia`. All user-facing documentation says "Ethereum Sepolia."

## 4. Chain config

- **Network key:** `ethereum-sepolia`
- **Chain ID:** 11155111
- **Public RPC fallback:** `https://ethereum-sepolia-rpc.publicnode.com`
- **Explorer:** `https://sepolia.etherscan.io`
- **Native token:** ETH
- **Wrapped native:** `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`
- **USDC:** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`
- **USDT:** `null`
- **Block time:** ~12s
- **Finality confirmations:** 3

Config verified in:
- `chains/evm/configs/networks.json`
- `chains/evm/foundry.toml`
- `chains/evm/.env.example`

## 5. domainId and assetIdVersion

- **domainId (decimal):** 33554435
- **domainId (hex):** `0x02000003`
- **assetIdVersion:** 2
- **assetIdFormula:** `white:asset_id:v2`

Formula:
```
0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]
```

Verified in:
- `packages/core/src/domains.ts` — `ProtocolDomain.ETHEREUM_SEPOLIA = 0x02000003`
- `chains/evm/script/Deploy.s.sol` — calls `configureDomain(domainId, 2)` and `setDomainId(domainId)`
- `packages/core/src/crypto.ts` — `computeAssetIdV2BigInt` matches Solidity formula

## 6. Deployment result

**Status: DEPLOYED ✅**

Deployment artifact written to `chains/evm/deployments/ethereum-sepolia.json`.

## 7. New deployed addresses

| Contract | Address |
|----------|---------|
| `WhiteProtocol` | `0x5813d68a130C451420C670F5aA4a7D68F438101A` |
| `AssetRegistry` | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` |
| `DepositVerifier` | `0x0eb44c154DF83876fB44042e822e3373Fbf57d95` |
| `WithdrawVerifier` | `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee` |
| `MerkleBatchVerifier` | `0x0Bb7ED4A34558A44FDc8bCC7c9560948a082bc9E` |

Deployer: `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`

## 8. Real verifier confirmation

✅ **Confirmed.**

`Deploy.s.sol` deployed real Groth16 verifiers via `_deployBytecode`:
- `DepositVerifier.sol:Groth16Verifier` → `0x0eb44c154DF83876fB44042e822e3373Fbf57d95`
- `WithdrawVerifier.sol:Groth16Verifier` → `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee`
- `MerkleBatchVerifier.sol:Groth16Verifier` → `0x0Bb7ED4A34558A44FDc8bCC7c9560948a082bc9E`

No mock verifier code path exists in the deployment script. On-chain code size verification:
- DepositVerifier: 3,077 bytes
- WithdrawVerifier: 4,007 bytes
- MerkleBatchVerifier: 3,449 bytes

## 9. Native ETH asset ID

Computed using `computeAssetIdV2BigInt(address(0), 0x02000003)`:

```
0x002eedb10e06c7047f8f59c54c5cfe2ecdf404186ba5af05b8eb07827446d4a0
```

- **Field-safe:** ✅ Yes (high bit = 0)
- **On-chain match:** ✅ `AssetRegistry.getAssetId(address(0))` returns identical value

## 10. WETH asset ID

Computed using `computeAssetIdV2BigInt(0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14, 0x02000003)`:

```
0x000bc1bc7baa5764be8307d4f6b9eee361a1fa25872d79dba0bc33a825b163d6
```

- **Field-safe:** ✅ Yes (high bit = 0)
- **On-chain match:** ✅ `AssetRegistry.getAssetId(WETH)` returns identical value

## 11. Base-vs-BNB-vs-Ethereum asset ID comparison

| Asset | Base Sepolia (0x02000002) | BSC Testnet (0x02000006) | Ethereum Sepolia (0x02000003) | Different? |
|-------|---------------------------|--------------------------|-------------------------------|------------|
| Native (address(0)) | `0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70` | `0x00da3c47f9788b071eb07d4801002c61a12dd3cc24d49b37b912483377b9a0d9` | `0x002eedb10e06c7047f8f59c54c5cfe2ecdf404186ba5af05b8eb07827446d4a0` | ✅ YES |

All asset IDs are field-safe. Domain separation works across all three EVM chains.

## 12. Build/test results

- **Forge build:** ✅ Passed (lint notes only, no errors)
- **Forge tests:** ✅ 70/70 passed
- **Core TypeScript tests:** ✅ 26/26 passed
- **Generalized E2E runner TypeScript compile:** ✅ Passed (`tsc --noEmit`)

## 13. E2E result

**Status: ALL TESTS PASSED ✅**

The generalized E2E runner executed successfully against Ethereum Sepolia:

1. Settle existing pending deposits (tree-state-aware) — none pending
2. Deposit native ETH with real DepositVerifier proof — ✅ PASSED
3. Batch settle with real MerkleBatchVerifier proof — ✅ PASSED
4. Withdraw with real WithdrawVerifier proof — ✅ PASSED
5. Double-spend rejection — ✅ PASSED

## 14. Deposit evidence

- **Tx hash:** `0xe22c278f088b3c35df69834e8944cd1e17fd217a3be27c9242773b69d863922b`
- **Amount:** 0.001 ETH
- **Status:** Recorded in pending buffer at index 0
- **Proof:** Real Groth16 deposit proof generated with snarkjs

## 15. Settlement evidence

- **Tx hash:** `0x3f2819d66a0fa918772c816432f0680c70ccc0b7b08d6022af69743b0bdb5b9b`
- **Old root:** `15019797232609675441998260052101280400536945603062888308240081994073687793470`
- **New root:** `9156390567213096958717380629108415778367...` (truncated)
- **Leaf index:** 0
- **Proof:** Real Groth16 MerkleBatchUpdate proof generated with snarkjs
- **On-chain root verified:** ✅ Matches computed new root

## 16. Withdraw evidence

- **Tx hash:** `0xb1f2349cff8b6e33d5d8d18f4540e93711584c9ea0ec471a532e58e10ece7a33`
- **Amount:** 0.001 ETH
- **Nullifier:** Marked as spent ✅
- **Balance change:** Recipient received ETH minus gas ✅
- **Proof:** Real Groth16 withdraw proof generated with snarkjs

## 17. Double-spend rejection evidence

- **Attempt:** Second withdraw with same nullifier hash
- **Result:** Transaction reverted on-chain ✅
- **Error pattern:** `execution reverted` / nullifier already spent

## 18. Gas summary

Actual gas used (from on-chain receipts):
- **Deposit:** ~120k gas
- **Settlement:** ~180k gas
- **Withdraw:** ~220k gas
- **Total per full E2E cycle:** ~0.001 ETH at 2 gwei

Sepolia ETH balance history:
- **Before deployment:** 0.3 ETH
- **After deployment + E2E:** ~0.2797 ETH
- **Spent:** ~0.0203 ETH

## 19. Explorer verification result

**Status: ALL CONTRACTS SUBMITTED ✅**

All 5 contracts were successfully submitted for verification on Etherscan Sepolia using the provided API key.

| Contract | Address | GUID | Status |
|----------|---------|------|--------|
| WhiteProtocol | `0x5813d68a130C451420C670F5aA4a7D68F438101A` | `vghdnrnuzzgr2fxdr4lngrm6edpet2e5sdetwhmtanr2aevlrf` | Submitted ✅ |
| AssetRegistry | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` | `6ytje5ucyab8axkcqp1dgziieuzlwbh4nev6c8aarkibr2mtgz` | Submitted ✅ |
| DepositVerifier | `0x0eb44c154DF83876fB44042e822e3373Fbf57d95` | `e6kdzxqagj5hgpsykw3eqhfsdkgxtc7y5nmcia5pgdsqwifvii` | Submitted ✅ |
| WithdrawVerifier | `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee` | `grrt9xrj1dgi74dydi2gfbrfymqrwwgmd9kf7depmy9r7xvncw` | Submitted ✅ |
| MerkleBatchVerifier | `0x0Bb7ED4A34558A44FDc8bCC7c9560948a082bc9E` | `6ntd4g1lum7rpxyv5yinr15ekgt1y2hudzpjtb5ffm9shvbcic` | Submitted ✅ |

**Etherscan Sepolia URLs:**
- https://sepolia.etherscan.io/address/0x5813d68a130c451420c670f5aa4a7d68f438101a
- https://sepolia.etherscan.io/address/0xe8efde51ca7b4b0dad84e5a7296baac87a09029b
- https://sepolia.etherscan.io/address/0x0eb44c154df83876fb44042e822e3373fbf57d95
- https://sepolia.etherscan.io/address/0x66c1741f1f85f7bb04286b7a26e870a8d3e52eee
- https://sepolia.etherscan.io/address/0x0bb7ed4a34558a44fdc8bcc7c9560948a082bc9e

## 20. Config promotion result

Ethereum Sepolia promoted to active supported testnet:

- `chains/evm/configs/networks.json` — `isLive: true` ✅
- `app/.env.example` — All `NEXT_PUBLIC_ETH_*` addresses populated ✅
- `app/src/config/ethereum.ts` — Runtime fallbacks populated ✅
- `app/src/config/chains.ts` — `ETHEREUM_SEPOLIA` config added, `SupportedChain` includes `"ethereum"`, `SUPPORTED_CHAINS` includes `"ethereum"` ✅
- `app/src/components/navbar.tsx` — Chain selector includes `"ethereum"` ✅
- `relayer/src/index.ts` — `ethRpcUrl`, `ethProtocolAddress`, `ethDeployerPrivateKey` added ✅
- `relayer/.env.example` — Ethereum Sepolia env vars documented ✅
- `render.yaml` — `ETH_RPC_URL` and `ETH_PROTOCOL_ADDRESS` added ✅
- `docs/audits/supporting-chains-implementation-audit.md` — Ethereum Sepolia row updated from `CONFIG_ONLY` to `COMPLETE` ✅

Do not mark Ethereum mainnet live.

## 21. Files changed

| File | Change |
|------|--------|
| `chains/evm/configs/networks.json` | Set `ethereum-sepolia.isLive` to `true` |
| `chains/evm/deployments/ethereum-sepolia.json` | **New** — deployment artifact with v2 domain-separated asset IDs |
| `chains/evm/broadcast/Deploy.s.sol/11155111/run-latest.json` | **New** — Foundry broadcast log |
| `app/.env.example` | Filled all `NEXT_PUBLIC_ETH_*` addresses; added Ethereum Sepolia section |
| `app/src/config/ethereum.ts` | **New** — Ethereum Sepolia contract addresses as runtime fallbacks |
| `app/src/config/chains.ts` | Added `ETHEREUM_SEPOLIA` chain config; updated `SupportedChain`, `CHAINS`, `SUPPORTED_CHAINS` |
| `app/src/components/navbar.tsx` | Added `"ethereum"` to chain selector array |
| `relayer/src/index.ts` | Added `ethRpcUrl`, `ethProtocolAddress`, `ethDeployerPrivateKey` to config |
| `relayer/.env.example` | Added Ethereum Sepolia env var documentation |
| `render.yaml` | Added `ETH_RPC_URL` and `ETH_PROTOCOL_ADDRESS` env vars |
| `chains/evm/package.json` | Added `test:e2e:ethereum:sepolia:*` and `test:e2e:eth:sepolia:*` scripts |
| `docs/audits/supporting-chains-implementation-audit.md` | Updated Ethereum Sepolia row from `CONFIG_ONLY` to `COMPLETE` with deployed address |
| `docs/fixes/PR-007-ethereum-sepolia-v2-e2e.md` | **New** — this file |

## 22. Remaining blockers

**None.** All blockers from the initial report are resolved.

- ~~Blocker 1: Deployer wallet funding~~ ✅ Resolved — funded with 0.3 Sepolia ETH
- ~~Blocker 2: ETHERSCAN_API_KEY~~ ✅ Resolved — verification submitted successfully

## 23. On-chain confirmations

| Check | Result |
|-------|--------|
| AssetRegistry.domainId == 0x02000003 | ✅ Confirmed |
| AssetRegistry.assetIdVersion == 2 | ✅ Confirmed |
| WhiteProtocol.domainId == 0x02000003 | ✅ Confirmed |
| Real verifiers wired (code > 0) | ✅ Confirmed |
| Native ETH asset ID matches TypeScript | ✅ Confirmed |
| WETH asset ID matches TypeScript | ✅ Confirmed |
| Base native asset ID != Ethereum native asset ID | ✅ Confirmed |
| BNB native asset ID != Ethereum native asset ID | ✅ Confirmed |

## 24. Final Ethereum Sepolia status

| Item | Status |
|------|--------|
| Config verified | ✅ Complete |
| Deploy script ready for v2 artifact | ✅ Complete |
| E2E runner generalized | ✅ Complete |
| Build/tests passing | ✅ Complete |
| Cross-domain asset ID proven offline | ✅ Complete |
| Deployer public address known | ✅ Complete |
| Deployer funded | ✅ Complete (0.3 Sepolia ETH) |
| Contracts deployed | ✅ Complete |
| Real verifiers confirmed | ✅ Complete |
| E2E deposit proven | ✅ Complete |
| E2E settlement proven | ✅ Complete |
| E2E withdraw proven | ✅ Complete |
| E2E double-spend proven | ✅ Complete |
| Explorer verification submitted | ✅ Complete |
| Config promoted to active | ✅ Complete |

**Overall PR-007 status: COMPLETE ✅**

## 25. Next recommended step

1. **Update live frontend/app `.env.local`** with Ethereum Sepolia addresses for any deployed frontend instances
2. **Update live relayer `.env`** with `ETH_RPC_URL`, `ETH_PROTOCOL_ADDRESS`, and `ETH_DEPLOYER_PRIVATE_KEY`
3. **Deploy a relayer instance** with Ethereum Sepolia support enabled (Render blueprint already updated)
4. **Run E2E against non-empty tree** to prove repeatability (same pattern as PR-006B)
5. **Proceed to Polygon Amoy** next for continued EVM expansion
