# PR-006 — BNB Chain Testnet v2 Deployment & E2E

## 1. Summary

PR-006 extends The White Protocol's verified EVM privacy stack from Base Sepolia to BNB Chain Testnet using v2 domain-separated asset IDs. All preparatory work is complete. Deployment and on-chain E2E are blocked pending tBNB funding for the deployer wallet.

## 2. Why BNB Chain Testnet was chosen next

- Base Sepolia v2 is already live and E2E-verified (PR-005C/005D/005E).
- BNB Chain is the next-highest priority in the target chain set (Solana, Ethereum, Base, BNB Chain, Polygon).
- Proving cross-domain asset ID separation requires at least two EVM domains with different `domainId`s.
- The repo already contains `bsc-testnet` network configuration and deployment script scaffolding.

## 3. Naming decision: BNB vs BSC

| Name in Repo | Meaning | Keep/Rename | Reason |
|--------------|---------|-------------|--------|
| `bsc-testnet` | Network key in configs/networks.json, Foundry profiles, package scripts | **Keep** | Internal config key; renaming risks breaking scripts, CI, and existing references |
| `bsc-mainnet` | Same as above for mainnet | **Keep** | Consistent with internal convention |
| `BSC_TESTNET_RPC_URL` | Environment variable name | **Keep** | Matches internal key naming |
| `BNB Chain Testnet` | User-facing / docs language | **Use in docs** | Public product language; BSC is legacy branding |
| `BNB` | Native token symbol | **Keep** | Already correct in networks.json |
| `ProtocolDomain.BSC_TESTNET` | TypeScript enum name | **Keep** | Internal code convention; changing breaks imports |

**Decision:** Internal identifiers remain `bsc-testnet`. All user-facing documentation says "BNB Chain Testnet."

## 4. Chain config

- **Network key:** `bsc-testnet`
- **Chain ID:** 97
- **Public RPC fallback:** `https://bsc-testnet-rpc.publicnode.com`
- **Explorer:** `https://testnet.bscscan.com`
- **Native token:** BNB
- **Wrapped native:** `0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd`
- **USDT:** `0x337610d27c682E347C9cD60BD4b3b107C9d34dDd`
- **Block time:** ~3s
- **Finality confirmations:** 5

Config verified in:
- `chains/evm/configs/networks.json`
- `chains/evm/foundry.toml`
- `chains/evm/.env.example`

## 5. domainId and assetIdVersion

- **domainId (decimal):** 33554438
- **domainId (hex):** `0x02000006`
- **assetIdVersion:** 2
- **assetIdFormula:** `white:asset_id:v2`

Formula:
```
0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]
```

Verified in:
- `packages/core/src/domains.ts` — `ProtocolDomain.BSC_TESTNET = 0x02000006`
- `chains/evm/script/Deploy.s.sol` — calls `configureDomain(domainId, 2)` and `setDomainId(domainId)`
- `packages/core/src/crypto.ts` — `computeAssetIdV2BigInt` matches Solidity formula

## 6. Deployment result

**Status: NOT DEPLOYED — blocked on funding**

No deployment artifact exists at `chains/evm/deployments/bsc-testnet.json`.
No broadcast logs exist for chain ID 97.

## 7. New deployed addresses

N/A — deployment blocked.

Expected addresses after deployment:
- `WhiteProtocol` — TBD
- `AssetRegistry` — TBD
- `DepositVerifier` — TBD
- `WithdrawVerifier` — TBD
- `MerkleBatchVerifier` — TBD

## 8. Real verifier confirmation

N/A — deployment blocked.

`Deploy.s.sol` is confirmed to deploy real Groth16 verifiers via `_deployBytecode`:
- `DepositVerifier.sol:Groth16Verifier`
- `WithdrawVerifier.sol:Groth16Verifier`
- `MerkleBatchVerifier.sol:Groth16Verifier`

No mock verifier code path exists in the deployment script.

## 9. Native BNB asset ID

Computed offline using `computeAssetIdV2BigInt(address(0), 0x02000006)`:

```
0x00da3c47f9788b071eb07d4801002c61a12dd3cc24d49b37b912483377b9a0d9
```

- **Field-safe:** ✅ Yes (high bit = 0)

## 10. WBNB asset ID

Computed offline using `computeAssetIdV2BigInt(0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd, 0x02000006)`:

```
0x003de6a9e3e36601a05189878aab2334eb4e60b49da8afd247525288ba3d77cc
```

- **Field-safe:** ✅ Yes (high bit = 0)

## 11. Base-vs-BNB asset ID comparison

| Asset | Base Sepolia (0x02000002) | BSC Testnet (0x02000006) | Different? |
|-------|---------------------------|--------------------------|------------|
| Native (address(0)) | `0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70` | `0x00da3c47f9788b071eb07d4801002c61a12dd3cc24d49b37b912483377b9a0d9` | ✅ YES |

Both asset IDs are field-safe. Domain separation works across EVM chains.

## 12. Build/test results

- **Forge build:** ✅ Passed (lint notes only, no errors)
- **Forge tests:** ✅ 70/70 passed
- **Core TypeScript tests:** ✅ 26/26 passed
- **Generalized E2E runner TypeScript compile:** ✅ Passed (`tsc --noEmit`)
- **Base Sepolia backward compat check:** ✅ Script starts correctly, reads artifact, detects tree state

## 13. E2E result

**Status: NOT RUN — blocked on funding**

The generalized E2E runner is ready and verified against Base Sepolia. It will run the following for BNB Chain Testnet once deployed:

1. Settle existing pending deposits (tree-state-aware)
2. Deposit native BNB with real DepositVerifier proof
3. Batch settle with real MerkleBatchVerifier proof
4. Withdraw with real WithdrawVerifier proof
5. Double-spend rejection

## 14. Deposit evidence

N/A — blocked.

## 15. Settlement evidence

N/A — blocked.

## 16. Withdraw evidence

N/A — blocked.

## 17. Double-spend rejection evidence

N/A — blocked.

## 18. Gas summary

N/A — blocked.

Estimated gas per operation (based on Base Sepolia):
- Deposit: ~120k gas
- Settlement: ~180k gas
- Withdraw: ~220k gas
- Total per full E2E cycle: ~0.002 BNB at 5 gwei

## 19. Explorer verification result or commands

**Status: Not attempted — no deployment yet.**

Once deployed, verify with:
```bash
cd chains/evm
forge verify-contract --chain-id 97 --compiler-version v0.8.20+commit.a1b79de6 \
  <WhiteProtocol-address> WhiteProtocol --watch
forge verify-contract --chain-id 97 --compiler-version v0.8.20+commit.a1b79de6 \
  <AssetRegistry-address> AssetRegistry --watch
# Repeat for DepositVerifier, WithdrawVerifier, MerkleBatchVerifier
```

BscScan API key env var: `BSCSCAN_API_KEY`

## 20. Files changed

| File | Change |
|------|--------|
| `chains/evm/test/e2e-base-full.ts` | **Rewritten** — generalized to any EVM network via `NETWORK` env var; reads RPC from networks.json or public fallback; uses native symbol from config; preserves all PR-005E tree-state awareness |
| `chains/evm/test/e2e-bsc-testnet.ts` | **New** — convenience wrapper that sets `NETWORK=bsc-testnet` and delegates to generalized runner |
| `chains/evm/test/e2e/e2e-bsc-testnet.ts` | **Updated** — deprecation warning added; points to new runner |
| `chains/evm/script/Deploy.s.sol` | **Updated** — writes `domainId`, `domainIdHex`, `assetIdVersion=2`, `assetIdFormula` to deployment artifact automatically |
| `chains/evm/package.json` | **Updated** — added `test:e2e:bsc:testnet:full` and `test:e2e:bsc:testnet:repeat` scripts; updated base scripts to pass `NETWORK=base-sepolia` explicitly |
| `chains/evm/.env` | **Updated** — added `BSC_TESTNET_RPC_URL=https://bsc-testnet-rpc.publicnode.com` (public fallback, not a secret) |

## 21. Remaining blockers

### Blocker 1: Deployer wallet has zero tBNB

- **Public address:** `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`
- **Current balance:** 0 tBNB
- **Minimum needed:** 0.05 tBNB for deployment + one E2E cycle
- **Recommended with buffer:** 0.2 tBNB for multiple E2E runs and verification retries
- **Faucet:** https://www.bnbchain.org/en/testnet-faucet

**Impact:** Deployment cannot proceed. E2E cannot run.

**Resolution:** Fund the deployer address from the BNB Chain testnet faucet, then re-run:
```bash
cd chains/evm
source .env
NETWORK=bsc-testnet forge script script/Deploy.s.sol --ffi --rpc-url $BSC_TESTNET_RPC_URL --broadcast --verify
NETWORK=bsc-testnet tsx test/e2e-base-full.ts
```

### Blocker 2: BscScan API key

- `BSCSCAN_API_KEY` env var is empty.
- Impact: Low. Contract verification is optional for E2E. Can be done later.

## 22. Final BNB Chain Testnet status

| Item | Status |
|------|--------|
| Config verified | ✅ Complete |
| Deploy script updated for v2 artifact | ✅ Complete |
| E2E runner generalized | ✅ Complete |
| Build/tests passing | ✅ Complete |
| Cross-domain asset ID proven offline | ✅ Complete |
| Deployer public address known | ✅ Complete |
| Deployer funded | ❌ Blocked (0 tBNB) |
| Contracts deployed | ❌ Blocked |
| E2E deposit proven | ❌ Blocked |
| E2E settlement proven | ❌ Blocked |
| E2E withdraw proven | ❌ Blocked |
| E2E double-spend proven | ❌ Blocked |

**Overall PR-006 status: BLOCKED on funding.**

## 23. Next recommended step

1. **Fund deployer wallet** `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c` with at least 0.2 tBNB via https://www.bnbchain.org/en/testnet-faucet
2. **Re-run deployment:** `npm run deploy:bsc-testnet`
3. **Run E2E:** `npm run test:e2e:bsc:testnet:full`
4. **Verify contracts** if `BSCSCAN_API_KEY` is available
5. **Promote artifact** to active if shadow validation is not needed (BSC testnet is not yet live)
6. **Update frontend/app config** with BSC testnet addresses if desired
