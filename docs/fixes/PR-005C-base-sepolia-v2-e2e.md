# PR-005C — Base Sepolia v2 Domain-Separated Asset ID Deployment & E2E

**Title:** Deploy and verify Base Sepolia v2 deployment with real Groth16 verifiers  
**Date:** 2026-05-02  
**Status:** ✅ Complete

---

## 1. Summary

PR-005C deploys a fresh Base Sepolia v2 instance of The White Protocol using the domain-separated asset ID formula introduced in PR-005B. The deployment uses real snarkJS-generated Groth16 verifier contracts (no mocks). A complete end-to-end test proves:

- Deposit with real ZK proof ✅
- Batch settlement with real ZK proof ✅
- Withdraw with real ZK proof ✅
- Double-spend rejection ✅
- TypeScript v2 asset IDs match on-chain Solidity values ✅

---

## 2. Deployment Artifact Strategy

**Option B — Shadow validation** (preferred per PR-005C instructions)

- Existing `deployments/base-sepolia.json` (PR-004 v1) is preserved unchanged.
- New v2 deployment is saved to `deployments/base-sepolia-v2.json`.
- This keeps v1 deployment history intact while proving v2 works live.

---

## 3. v2 Domain ID

| Network | Hex | Decimal |
|---------|-----|---------|
| Base Sepolia | `0x02000002` | 33554434 |

Structure: high byte `0x02` = EVM family, low 3 bytes `0x000002` = network ID 2.

---

## 4. v2 Asset ID Formula

```
assetId = 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]
```

Properties:
- MSB is zero → always < 2^248 < BN254 field prime
- Domain separation → same token on different chains produces different asset IDs
- Version prefix prevents collision with v1

---

## 5. Build / Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| Forge build | — | ✅ OK (no compilation errors) |
| Forge tests | 70 | ✅ 70 passed, 0 failed |
| TypeScript Core | 26 | ✅ 26 passed (stealth tests) |

---

## 6. Deployment Result

Deployer: `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`

Contracts deployed to Base Sepolia (chainId 84532):

| Contract | Address |
|----------|---------|
| WhiteProtocol | `0x396e539bCDeAF48ab9526A13c6E688CBA69C059a` |
| AssetRegistry | `0xc2508F03c42B11b79ef4aA979b9FfA7f62D003B7` |
| DepositVerifier | `0xD566bdec3263476B453DBFE7AAE1c6E2123E90C5` |
| WithdrawVerifier | `0x8Bb36a8F6ccE6439899eB5f025E8bF532c938233` |
| MerkleBatchVerifier | `0x818E535D774F329dfE9Cdf8C95F8ff7Ee85c822B` |

Deployment saved to: `chains/evm/deployments/base-sepolia-v2.json`

---

## 7. New v2 Addresses

See section 6 above.

---

## 8. Real Verifier Confirmation

All three verifier contracts are auto-generated snarkJS Groth16 verifiers using Ethereum precompiles (`ecMul`, `ecAdd`, `ecPairing`). No mock verifiers were used.

- DepositVerifier: 1537 bytes, verifies 3 public inputs
- WithdrawVerifier: 2002 bytes, verifies 8 public inputs
- MerkleBatchVerifier: 1723 bytes, verifies 5 public inputs

---

## 9. Domain / Asset Version On-Chain Checks

| Check | On-Chain Value | Expected | Result |
|-------|---------------|----------|--------|
| AssetRegistry.domainId() | 33554434 | 33554434 | ✅ |
| AssetRegistry.assetIdVersion() | 2 | 2 | ✅ |
| AssetRegistry.isLegacyV1() | false | false | ✅ |
| WhiteProtocol.domainId() | 33554434 | 33554434 | ✅ |
| WhiteProtocol.domainIdSet() | true | true | ✅ |

---

## 10. address(0) Asset ID Comparison: Solidity vs TypeScript

| Source | Value |
|--------|-------|
| Solidity (`AssetRegistry.getAssetId(address(0))`) | `0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70` |
| TypeScript (`computeAssetIdV2BigInt(address(0), 33554434)`) | `0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70` |
| Match | ✅ YES |
| Field-safe (< 2^248) | ✅ YES (MSB = 0x00) |

---

## 11. WETH Asset ID Comparison: Solidity vs TypeScript

| Source | Value |
|--------|-------|
| Solidity (`AssetRegistry.getAssetId(0x4200...0006)`) | `0x0080941d8a19784466c37cf54ecbcd55820f61d8e9649dd95bee1306d78800b1` |
| TypeScript (`computeAssetIdV2BigInt(weth, 33554434)`) | `0x0080941d8a19784466c37cf54ecbcd55820f61d8e9649dd95bee1306d78800b1` |
| Match | ✅ YES |
| Field-safe (< 2^248) | ✅ YES (MSB = 0x00) |

---

## 12. Base Sepolia v2 E2E Result

**Result: ALL TESTS PASSED ✓**

| Step | Status | Tx Hash |
|------|--------|---------|
| Deposit | ✅ PASSED | `0x678e3c84e3d746d1a30d926429909dbdee2e182d048fe7ce02eeee4c3a767771` |
| Settlement | ✅ PASSED | `0xba4b0bff6081fe1b6c8bc2ab54878f9077fdfd13bb93bfa474411dd8c2ebaf6c` |
| Withdraw | ✅ PASSED | `0xa85bf5624b722fe9a8c8e81b47d0e19c63163ad47604be98ec5feb1ff1591766` |
| Double-spend rejection | ✅ PASSED | N/A (reverted as expected) |

---

## 13. Deposit Evidence

- **Tx:** `0x678e3c84e3d746d1a30d926429909dbdee2e182d048fe7ce02eeee4c3a767771`
- **Gas used:** 327,207
- **Amount:** 0.001 ETH
- **Asset ID:** v2 `0x00fb58d8...1d54a70`
- **Proof:** Real Groth16 deposit proof generated with snarkjs + `deposit.wasm` + `deposit.zkey`
- **Result:** Commitment queued to pending buffer at index 0

---

## 14. Settlement Evidence

- **Tx:** `0xba4b0bff6081fe1b6c8bc2ab54878f9077fdfd13bb93bfa474411dd8c2ebaf6c`
- **Gas used:** 1,086,316
- **Batch size:** 1
- **Old root:** `15019797232609675441998260052101280400536945603062888308240081994073687793470`
- **New root:** `1486877347712115186719234431859232003835...` (matches on-chain)
- **Proof:** Real Groth16 `merkle_batch_update` proof
- **Result:** Merkle tree updated, `nextLeafIndex` = 1

---

## 15. Withdraw Evidence

- **Tx:** `0xa85bf5624b722fe9a8c8e81b47d0e19c63163ad47604be98ec5feb1ff1591766`
- **Gas used:** 324,810
- **Amount:** 0.001 ETH
- **Asset ID:** v2 `0x00fb58d8...1d54a70`
- **Proof:** Real Groth16 withdraw proof generated with snarkjs + `withdraw.wasm` + `withdraw.zkey`
- **Result:** Nullifier marked spent, ETH returned to recipient minus gas

---

## 16. Double-Spend Rejection Evidence

- **Attempt:** Second withdraw with identical nullifier hash against same Merkle root
- **Result:** Transaction reverted with `"Nullifier already spent"`
- **On-chain check:** `WhiteProtocol.isSpent(nullifierHash)` returns `true` after first withdrawal

---

## 17. Stealth E2E Result

**Deferred.**

The stealth withdrawal ABI (`withdrawStealth`) was validated in PR-003B. A full stealth E2E with ephemeral secp256k1 key generation, 33-byte compressed pubkey, and scanner detection is out of scope for PR-005C and remains a follow-up item.

---

## 18. Basescan Verification

**Status:** Not executed (no `BASESCAN_API_KEY` configured)

**Exact verify commands for manual execution:**

```bash
# DepositVerifier
forge verify-contract --chain-id 84532 --compiler-version v0.8.20+commit.a1b79de6 \
  0xD566bdec3263476B453DBFE7AAE1c6E2123E90C5 DepositVerifier --etherscan-api-key $BASESCAN_API_KEY

# WithdrawVerifier
forge verify-contract --chain-id 84532 --compiler-version v0.8.20+commit.a1b79de6 \
  0x8Bb36a8F6ccE6439899eB5f025E8bF532c938233 WithdrawVerifier --etherscan-api-key $BASESCAN_API_KEY

# MerkleBatchVerifier
forge verify-contract --chain-id 84532 --compiler-version v0.8.20+commit.a1b79de6 \
  0x818E535D774F329dfE9Cdf8C95F8ff7Ee85c822B MerkleBatchVerifier --etherscan-api-key $BASESCAN_API_KEY

# AssetRegistry
forge verify-contract --chain-id 84532 --compiler-version v0.8.20+commit.a1b79de6 \
  0xc2508F03c42B11b79ef4aA979b9FfA7f62D003B7 AssetRegistry --etherscan-api-key $BASESCAN_API_KEY

# WhiteProtocol
forge verify-contract --chain-id 84532 --compiler-version v0.8.20+commit.a1b79de6 \
  0x396e539bCDeAF48ab9526A13c6E688CBA69C059a WhiteProtocol --etherscan-api-key $BASESCAN_API_KEY
```

**Explorer links:**
- WhiteProtocol: https://sepolia.basescan.org/address/0x396e539bCDeAF48ab9526A13c6E688CBA69C059a
- AssetRegistry: https://sepolia.basescan.org/address/0xc2508F03c42B11b79ef4aA979b9FfA7f62D003B7

---

## 19. Files Changed

| File | Change |
|------|--------|
| `chains/evm/deployments/base-sepolia-v2.json` | **New** — v2 deployment artifact with domainId and assetIdVersion |
| `chains/evm/test/e2e-base-full.ts` | **Updated** — artifact-aware, auto-selects v1/v2 asset ID formula |
| `chains/evm/package.json` | **Updated** — added `test:e2e:base:v2:full` script |
| `chains/evm/deployments/base-sepolia-v1-backup.json` | **New** — backup of original PR-004 v1 artifact |
| `docs/fixes/PR-005C-base-sepolia-v2-e2e.md` | **New** — this report |

**Files NOT changed:**
- `circuits/` — no circuit changes
- `chains/evm/contracts/` — no contract changes (PR-005B already done)
- `chains/evm/script/Deploy.s.sol` — no deployment bugs found
- `chains/evm/configs/networks.json` — no metadata corrections needed
- `chains/evm/deployments/base-sepolia.json` — preserved as v1 artifact

---

## 20. Remaining Blockers

| Blocker | Impact | Mitigation |
|---------|--------|------------|
| No `BASESCAN_API_KEY` | Contracts not auto-verified on Basescan | Manual verification with commands above |
| Stealth E2E deferred | Stealth path not proven live in this PR | Follow-up PR; ABI already validated in PR-003B |
| `merkle_batch_update` limited to batch size 1 | Settlement throughput | Known limitation; circuits capable of larger batches |
| Insecure trusted setup | Production deployment risk | Requires dedicated MPC ceremony before mainnet |

---

## 21. Final Base Sepolia v2 Status

| Criterion | Status |
|-----------|--------|
| Base Sepolia v2 deployed | ✅ |
| Domain ID = 0x02000002 | ✅ |
| AssetRegistry assetIdVersion == 2 | ✅ |
| WhiteProtocol domainId == 0x02000002 | ✅ |
| Real verifiers (no mocks) | ✅ |
| Solidity / TypeScript asset IDs match | ✅ |
| address(0) v2 field-safe | ✅ |
| WETH v2 field-safe | ✅ |
| Deposit → Settle → Withdraw E2E | ✅ |
| Double-spend rejection | ✅ |

---

## 22. Next Recommended Step

1. **Set `BASESCAN_API_KEY`** and run the verify commands in section 18.
2. **Run a stealth withdrawal E2E** as a follow-up PR to prove the stealth address layer end-to-end.
3. **Update `app/` and `relayer/` configs** to optionally point to the v2 deployment for integration testing.
4. **Keep v1 artifact** (`base-sepolia.json`) active for existing integrations until v2 is promoted.
5. **When ready to promote v2:** copy `base-sepolia-v2.json` → `base-sepolia.json` and update downstream references.

---

*PR-005C — Privacy, Pure and Simple.*
