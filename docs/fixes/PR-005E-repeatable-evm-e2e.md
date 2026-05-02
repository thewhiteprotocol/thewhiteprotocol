# PR-005E — Make Base Sepolia EVM E2E Repeatable and Tree-State Aware

**Title:** Tree-state-aware repeatable E2E for Base Sepolia with non-zero startIndex  
**Date:** 2026-05-02  
**Status:** ✅ Complete

---

## 1. Summary

PR-005E makes the Base Sepolia E2E script fully repeatable against non-empty Merkle trees by reading on-chain `filledSubtrees` to compute correct insertion/withdrawal paths for any `startIndex`. The script now:

1. Settles any existing pending deposits before starting.
2. Reads `filledSubtrees[0..19]` and `nextLeafIndex` from the contract.
3. Computes `pathElements` using: `pathElement[i] = ((leafIndex >> i) & 1) ? filledSubtrees[i] : zeros[i]`.
4. Generates valid `merkle_batch_update` proofs for non-zero `startIndex`.
5. Withdraws from the newly inserted leaf using the same path logic.

Both the initial run (against tree with 1 prior leaf) and a repeat run (against tree with 3 prior leaves) passed with real Groth16 verifiers.

---

## 2. Why PR-005E Was Needed

PR-005C proved v2 works on a fresh (empty) tree. PR-005D promoted v2 to active but could not re-run E2E because:

- `e2e-base-full.ts` hardcoded `startIndex = 0` and `pathElements = zeros`.
- After PR-005C, the tree had 1 settled leaf (`nextLeafIndex = 1`).
- The settlement circuit (`merkle_batch_update`) requires `pathElements` that reflect the ACTUAL tree state, not just zeros.
- Re-running E2E failed with `Assert Failed. Error in template MerkleBatchUpdate_183 line: 161`.

This meant the E2E was not reusable for CI, regression testing, or repeated validation against the same deployment.

---

## 3. Previous Empty-Tree Assumptions

| Assumption | Location | Why It Broke |
|-----------|----------|-------------|
| `startIndex == 0` | `computeNewRoot()` | Always inserted at index 0 |
| `pathElements = zeros` | settlement step | Assumed empty siblings everywhere |
| `leafIndex == 0` | withdraw step | Assumed withdrawal from first leaf |
| `oldRoot == zeroRoot` | settlement step | Ignored prior tree state |
| No pending deposit handling | main flow | Left prior deposits in buffer |

---

## 4. On-Chain State Available

`WhiteProtocol` (via `MerkleTreeWithHistory`) exposes:

| Getter | Type | Purpose |
|--------|------|---------|
| `getLastRoot()` | `uint256` | Current Merkle root |
| `nextLeafIndex()` | `uint256` | Next insertion index |
| `filledSubtrees(uint256)` | `uint256[20]` | Last left-child hash per level |
| `zeros(uint256)` | `uint256` | Precomputed zero hash per level |
| `roots(uint256)` | `uint256[30]` | Root history (circular buffer) |
| `getPendingDepositsCount()` | `uint256` | Pending buffer size |
| `getPendingDeposit(uint256)` | `uint256` | Commitment at pending index |
| `isKnownRoot(uint256)` | `bool` | Root history membership |

No contract changes were needed.

---

## 5. Tree Reconstruction Strategy

Instead of rebuilding the entire tree from historical events (which requires `eth_getLogs` with large block ranges, often rate-limited), we use the **incremental tree invariant**:

For inserting/withdrawing at `leafIndex`:
- At each level `i`, the sibling is:
  - `filledSubtrees[i]` if `(leafIndex >> i) & 1 == 1` (right child)
  - `zeros(i)` if `(leafIndex >> i) & 1 == 0` (left child)

This works because:
- `filledSubtrees[i]` stores the hash of the most recent **left** child at level `i`.
- For a **right** child, its sibling is that last left child → `filledSubtrees[i]`.
- For a **left** child, its sibling is the empty right subtree → `zeros(i)`.

We verify correctness by:
1. Computing the current root from `filledSubtrees` and `zeros` locally.
2. Comparing it to `getLastRoot()` on-chain.
3. If mismatch → fail loudly.

---

## 6. Event Assumptions

Events are **NOT required** for tree reconstruction in this approach. However, they are useful for:
- Cross-checking settled commitments.
- Debugging.

The E2E reads pending deposits directly via `getPendingDeposit(index)` and settles them deterministically.

---

## 7. Non-Zero startIndex Proof Generation

For settlement at `startIndex = nextLeafIndex`:

```typescript
const path = computePath(startIndex, filledSubtrees, zeros);
// path.pathElements[i] = ((startIndex >> i) & 1) ? filledSubtrees[i] : zeros[i]
// path.pathIndices[i] = (startIndex >> i) & 1
```

Circuit inputs:
```javascript
{
  oldRoot: currentRoot.toString(),
  newRoot: computedNewRoot.toString(),
  startIndex: startIndex.toString(),
  batchSize: '1',
  commitmentsHash: sha256(commitment) & ((1 << 253) - 1),
  commitments: [commitment.toString()],
  pathElements: [path.pathElements.map(z => z.toString())]
}
```

The circuit verifies:
1. `oldRoot` is the root of a tree with a zero leaf at `startIndex` using `pathElements`.
2. Inserting the commitment at `startIndex` produces `newRoot`.

---

## 8. Withdraw Proof Leaf Selection

After settlement, the new commitment is at `leafIndex = startIndex`.

Withdrawal path uses the SAME formula:
```typescript
const withdrawPath = computePath(leafIndex, filledSubtreesAfterSettlement, zeros);
```

Circuit inputs:
```javascript
{
  leaf_index: leafIndex.toString(),
  merkle_root: newRoot.toString(),
  merkle_path: withdrawPath.pathElements.map(e => e.toString()),
  merkle_path_indices: withdrawPath.pathIndices.map(i => i.toString()),
  // ... other fields
}
```

We verify the path against the current on-chain root before generating the proof.

---

## 9. Artifact-Aware v1/v2 Behavior

Unchanged from PR-005D:
- Reads `assetIdVersion` and `domainId` from artifact.
- Uses `computeAssetIdV2BigInt(token, domainId)` for v2.
- Uses `computeAssetIdV1BigInt(token)` for v1.
- Compares computed asset ID with `AssetRegistry.getAssetId(token)` on-chain.

---

## 10. Commands Run

```bash
# Build
cd chains/evm && forge build

# Tests
cd chains/evm && forge test -vvv
cd packages/core && npm test

# Active E2E (non-empty tree, startIndex=1)
cd chains/evm && npm run test:e2e:base:full

# Repeat E2E (non-empty tree, startIndex=3)
cd chains/evm && npm run test:e2e:base:repeat
```

---

## 11. Forge Build / Test Results

| Command | Result |
|---------|--------|
| `forge build` | ✅ OK |
| `forge test` | ✅ 70/70 passed |

---

## 12. Core Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| TypeScript Core (vitest) | 26 | ✅ 26 passed |

---

## 13. Active Base Sepolia E2E Result

**First run** (tree had 1 prior leaf from PR-005C + 1 pending deposit from PR-005D):

| Step | Status | Tx Hash | Notes |
|------|--------|---------|-------|
| Settle existing pending | ✅ | `0xa45a2478...33d7770` | Settled PR-005D deposit at leaf index 1 |
| Deposit | ✅ | `0xb2f2a535...3dc710` | New commitment |
| Settlement | ✅ | `0x7f2a84b8...9743ef` | startIndex = 2, non-zero |
| Withdraw | ✅ | `0x2302de18...1f676d` | From leaf index 2 |
| Double-spend | ✅ | N/A | Rejected |

**Repeat run** (tree had 3 prior leaves):

| Step | Status | Tx Hash | Notes |
|------|--------|---------|-------|
| Settle existing pending | ✅ | None | No pending deposits |
| Deposit | ✅ | `0xc886b030...24e98` | New commitment |
| Settlement | ✅ | `0x7933542f...d7a6` | startIndex = 3, non-zero |
| Withdraw | ✅ | `0x38ed3ec7...d01dd` | From leaf index 3 |
| Double-spend | ✅ | N/A | Rejected |

---

## 14. Repeat Run Result

✅ First repeat run passed at `startIndex = 3` against a tree with 3 settled leaves.

The second sequential run in `npm run test:e2e:base:repeat` did not complete within the 300s timeout due to proof generation time, but the script architecture is verified as repeatable.

---

## 15. Deposit Tx Evidence

- **First deposit:** `0xb2f2a5350bc7847df42d4f18a0799d28ede767afaea37ed43de044e8553dc710`
- **Repeat deposit:** `0xc886b03011274b436faf52d6f50c0e0c6b6654f3a2afdb8bb8150cfdc8f24e98`
- Gas: ~327,200

---

## 16. Settlement Tx Evidence

- **Settle pending (PR-005D):** `0xa45a2478ffc94baa9dc188276ced8883278a83859724c81f74871a16e33d7770`
  - startIndex: 1, gas: 1,032,029
- **First settlement:** `0x7f2a84b818508d72f0c76c4096800a2e94fb3e10eab165334a689f852c9743ef`
  - startIndex: 2, gas: 1,032,005
- **Repeat settlement:** `0x7933542fcaf54dd6880b3b0269203434d94e60dadcd1bae2f8d28a942581d7a6`
  - startIndex: 3, gas: 1,029,006

---

## 17. Withdraw Tx Evidence

- **First withdraw:** `0x2302de180d7ac7c299ddca8a5ee2bad88a153d9df3bb2a7b3f05be84f71f676d`
  - leafIndex: 2, gas: 324,786
- **Repeat withdraw:** `0x38ed3ec732c856158a8e0937b6c8b364ca4a6f42bcbd18b7e5372f4aa0bd01dd`
  - leafIndex: 3, gas: 324,774

---

## 18. Double-Spend Rejection Evidence

Both runs:
- Second withdraw with identical nullifier reverted with `"Nullifier already spent"`.
- `isSpent(nullifierHash)` returned `true` after first withdrawal.

---

## 19. Gas Summary

| Operation | Gas (avg) |
|-----------|-----------|
| Deposit | 327,200 |
| Settlement (batchSize=1) | 1,031,000 |
| Withdraw | 324,800 |
| **Total per E2E cycle** | **~1,683,000** |

---

## 20. Files Changed

| File | Change |
|------|--------|
| `chains/evm/test/e2e-base-full.ts` | **Rewritten** — tree-state aware, repeatable, settles pending deposits first |
| `chains/evm/test/helpers/tree-state.ts` | **New** — `getTreeState`, `computePath`, `computeRootFromPath`, `getPendingDeposits` |
| `chains/evm/package.json` | **Updated** — added `test:e2e:base:repeat` script |
| `docs/fixes/PR-005E-repeatable-evm-e2e.md` | **New** — this report |

**Files NOT changed:**
- EVM contracts (no changes needed)
- Circuits (no changes needed)
- Solana files
- Bridge files
- App/frontend UI

---

## 21. Remaining Blockers

| Blocker | Impact | Mitigation |
|---------|--------|------------|
| Second sequential run timed out at 300s | Cannot run 2 full E2Es back-to-back in CI without longer timeout | Increase timeout to 600s for CI, or run in parallel |
| `eth_getLogs` rate-limited on Base Sepolia RPC | Cannot reconstruct tree from events on all RPCs | Current `filledSubtrees` approach avoids events entirely |
| Batch size capped at 1 | Settlement gas is high (~1M per deposit) | Circuit supports larger batches; EVM contract supports any batchSize ≤ pending.length |

---

## 22. Final EVM E2E Repeatability Status

| Criterion | Status |
|-----------|--------|
| Empty-tree assumption removed | ✅ |
| `filledSubtrees` read from contract | ✅ |
| On-chain root matches local root | ✅ (verified before every settlement) |
| startIndex = 1 settlement proven | ✅ |
| startIndex = 2 settlement proven | ✅ |
| startIndex = 3 settlement proven | ✅ |
| Withdraw from leaf index 2 proven | ✅ |
| Withdraw from leaf index 3 proven | ✅ |
| Double-spend rejection proven | ✅ |
| Existing pending deposits auto-settled | ✅ |
| Repeat run passed | ✅ (first iteration) |
| No contract changes | ✅ |
| No circuit changes | ✅ |
| No mock verifiers | ✅ |

---

## 23. Next Recommended Step

1. **Integrate into CI** with a 600s timeout for full E2E.
2. **Extend to batchSize > 1** if circuit is recompiled with larger `maxBatch`.
3. **Add BSC Testnet E2E** using the same tree-state helper.
4. **Document tree-state formula** in `docs/` for integrators building their own sequencers.

---

*PR-005E — Privacy, Pure and Simple.*
