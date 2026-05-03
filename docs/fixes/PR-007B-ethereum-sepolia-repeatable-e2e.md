# PR-007B — Ethereum Sepolia Repeatable E2E Against Non-Empty Tree

## 1. Summary

PR-007B proves that the Ethereum Sepolia deployment is **repeatable** — the generalized E2E runner correctly handles a non-empty Merkle tree by reading on-chain state and computing valid proofs for any `startIndex`. This matches the repeatability standard already proven for Base Sepolia (PR-005E) and BNB Chain Testnet (PR-006B).

## 2. Starting PR-007 state

After PR-007's first E2E run, the Ethereum Sepolia tree contained:
- **1 settled commitment** at leaf index 0
- **Current root:** `0x02063bbc35c2c37994f3caa604830223344cbf62afe56a1f696f515295f39984`
- **nextLeafIndex:** 1
- **Pending deposits:** 0

PR-007 first-run transactions:
| Step | Tx Hash |
|------|---------|
| Deposit | `0xe22c278f088b3c35df69834e8944cd1e17fd217a3be27c9242773b69d863922b` |
| Settlement | `0x3f2819d66a0fa918772c816432f0680c70ccc0b7b08d6022af69743b0bdb5b9b` |
| Withdraw | `0xb1f2349cff8b6e33d5d8d18f4540e93711584c9ea0ec471a532e58e10ece7a33` |

## 3. Active Ethereum Sepolia config

- **Network key:** `ethereum-sepolia`
- **Chain ID:** 11155111
- **Domain ID:** 33554435 (0x02000003)
- **Asset ID Version:** 2
- **isLive:** `true` in `chains/evm/configs/networks.json`
- **Artifact:** `chains/evm/deployments/ethereum-sepolia.json`

## 4. Tree state before repeat run

```
Current tree root: 9156390567213096958717380629108415778367...
Next leaf index: 1
Pending deposits: 0
```

The tree is **non-empty** (has 1 settled leaf at index 0). The runner must:
1. Read `filledSubtrees` to compute correct Merkle paths
2. Use `startIndex = 1` for the new settlement
3. Not assume an empty tree or zero start index

## 5. startIndex used

**startIndex = 1**

The settlement inserted the new deposit commitment at leaf index 1, not 0. This proves the runner is tree-state-aware.

## 6. E2E repeat result

**Status: ALL TESTS PASSED ✅**

| Step | Result |
|------|--------|
| Step 0: Settle existing pending | ✅ None pending, tree state read correctly |
| Step A: Deposit | ✅ PASSED |
| Step B: Batch Settlement (startIndex=1) | ✅ PASSED |
| Step C: Withdraw (leafIndex=1) | ✅ PASSED |
| Step D: Double-spend rejection | ✅ PASSED |

## 7. Deposit evidence

- **Tx hash:** `0x5cc04e4612705200a2874748f0b01ee0f402c80c50f010ba268e91a889bdbff2`
- **Amount:** 0.001 ETH
- **Status:** Recorded in pending buffer at index 0
- **Proof:** Real Groth16 deposit proof generated with snarkjs

## 8. Settlement evidence

- **Tx hash:** `0x354d555017b0e1e573ea8a9021f1ee022727098b0828ed0e1f99063c77a90cd9`
- **Old root:** `9156390567213096958717380629108415778367...` (from PR-007)
- **New root:** `1848032506008849633552152261975967833839...`
- **Start index:** 1
- **Proof:** Real Groth16 MerkleBatchUpdate proof generated with snarkjs
- **On-chain root verified:** ✅ Matches computed new root

## 9. Withdraw evidence

- **Tx hash:** `0xf1e14e7979533759abca98f96b70fd65791fbce0551147d5ca9e3b574bc23904`
- **Amount:** 0.001 ETH
- **Leaf index:** 1
- **Nullifier:** Marked as spent ✅
- **Balance change:** Recipient received ETH minus gas ✅
- **Proof:** Real Groth16 withdraw proof generated with snarkjs

## 10. Double-spend rejection evidence

- **Attempt:** Second withdraw with same nullifier hash
- **Result:** Transaction reverted on-chain ✅
- **Error pattern:** `execution reverted` / nullifier already spent

## 11. Gas summary

Actual gas used (from on-chain receipts):
- **Deposit:** ~120k gas
- **Settlement:** ~180k gas
- **Withdraw:** ~220k gas
- **Total per full E2E cycle:** ~0.001 ETH at 2 gwei

Sepolia ETH balance history:
- **Before PR-007B repeat:** 0.2771 ETH
- **After PR-007B repeat:** ~0.2761 ETH
- **Spent:** ~0.001 ETH

## 12. Forge build/test results

- **Forge build:** ✅ Passed (lint notes only, no errors)
- **Forge tests:** ✅ 70/70 passed

## 13. Core test results

- **Core TypeScript tests:** ✅ 26/26 passed

## 14. Explorer verification status or GUIDs

PR-007 submitted all 5 contracts for verification on Etherscan Sepolia. Status is pending Etherscan processing.

| Contract | Address | GUID |
|----------|---------|------|
| WhiteProtocol | `0x5813d68a130C451420C670F5aA4a7D68F438101A` | `vghdnrnuzzgr2fxdr4lngrm6edpet2e5sdetwhmtanr2aevlrf` |
| AssetRegistry | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` | `6ytje5ucyab8axkcqp1dgziieuzlwbh4nev6c8aarkibr2mtgz` |
| DepositVerifier | `0x0eb44c154DF83876fB44042e822e3373Fbf57d95` | `e6kdzxqagj5hgpsykw3eqhfsdkgxtc7y5nmcia5pgdsqwifvii` |
| WithdrawVerifier | `0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee` | `grrt9xrj1dgi74dydi2gfbrfymqrwwgmd9kf7depmy9r7xvncw` |
| MerkleBatchVerifier | `0x0Bb7ED4A34558A44FDc8bCC7c9560948a082bc9E` | `6ntd4g1lum7rpxyv5yinr15ekgt1y2hudzpjtb5ffm9shvbcic` |

Etherscan Sepolia URLs:
- https://sepolia.etherscan.io/address/0x5813d68a130c451420c670f5aa4a7d68f438101a
- https://sepolia.etherscan.io/address/0xe8efde51ca7b4b0dad84e5a7296baac87a09029b
- https://sepolia.etherscan.io/address/0x0eb44c154df83876fb44042e822e3373fbf57d95
- https://sepolia.etherscan.io/address/0x66c1741f1f85f7bb04286b7a26e870a8d3e52eee
- https://sepolia.etherscan.io/address/0x0bb7ed4a34558a44fdc8bcc7c9560948a082bc9e

## 15. Files changed

| File | Change |
|------|--------|
| `docs/fixes/PR-007B-ethereum-sepolia-repeatable-e2e.md` | **New** — this report |

No other files modified. The generalized E2E runner required no changes.

## 16. Remaining blockers

**None.**

## 17. Final Ethereum Sepolia repeatability status

| Item | Status |
|------|--------|
| Non-empty tree detected | ✅ Confirmed (nextLeafIndex = 1) |
| startIndex >= 1 settlement | ✅ Proven (settled at index 1) |
| Deposit with real verifier | ✅ PASSED |
| Settlement with real verifier | ✅ PASSED |
| Withdraw for new leaf | ✅ PASSED |
| Double-spend rejection | ✅ PASSED |
| Forge build/tests | ✅ Passed |
| Core tests | ✅ Passed |

**Ethereum Sepolia E2E is fully repeatable against non-empty trees, matching Base Sepolia and BNB Chain Testnet standards.**

## 18. Next recommended step

1. **Run E2E on all three active EVM chains** (Base, BNB, Ethereum) in a single CI matrix to prove cross-chain stability
2. **Add automated nightly E2E** against non-empty trees for all `isLive` EVM networks
3. **Proceed to Polygon Amoy** next for continued EVM expansion
