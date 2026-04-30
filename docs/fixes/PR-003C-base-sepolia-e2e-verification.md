# PR-003C — Base Sepolia E2E Verification & Cleanup

## 1. Summary

PR-003C finalizes the Base Sepolia EVM deployment from PR-003B by:
- Fixing the pre-existing TypeScript E2E compilation environment.
- Updating all stale old-address references in frontend, app, docs, and config.
- Attempting full deposit→settle→withdraw E2E on Base Sepolia.
- Documenting the exact on-chain blocker that prevents E2E from completing.
- Adding contract verification support and documenting the verify command.

**Result:** Base Sepolia is **smoke verified and cleanly configured**, but **full E2E is blocked by a protocol-level asset-ID/field-prime mismatch** that existed before PR-003B and was masked by the prior TS compilation issues.

---

## 2. Starting State from PR-003B

| Item | Status |
|------|--------|
| Contracts deployed with updated stealth ABI | ✅ LIVE |
| Real Groth16 verifiers used | ✅ Confirmed |
| Deployment artifact updated | ✅ `chains/evm/deployments/base-sepolia.json` |
| Core protocol smoke checks | ✅ 11/11 passed |
| Stealth ABI validation on-chain | ✅ 3/3 passed |
| Forge tests | ✅ 55/55 passed |
| Relayer ABI updated | ✅ `bytes ephemeralPubkey` |
| App fallback addresses updated | ✅ Partial (verifiers still stale) |
| Full deposit→settle→withdraw E2E | ❌ Not run (pre-existing TS env issue) |
| Contract verification on Basescan | ❌ Not done (missing API key) |

**New deployment addresses:**
```json
{
  "WhiteProtocol": "0xC7632F1E2F38d1a16A9C451129a9d24edB10A265",
  "AssetRegistry": "0x7B4eD77809d1F54C6b8aE1d743b086471D488253",
  "DepositVerifier": "0xbcC566af14aDC6a7872Fb99379148F86Eb807394",
  "WithdrawVerifier": "0x78508a36ceE77c9171A6B7963175b369834D9F21",
  "MerkleBatchVerifier": "0xF2BCD1aF0B70fF9c206d5e2059f98F9c9148470C"
}
```

---

## 3. Address Reference Audit

Searched for old addresses across the repo (excluding `node_modules`, `.git`, and broadcast logs):

| File | Address/Reference | Status | Action |
|------|-------------------|--------|--------|
| `frontend/client/src/sections/DevnetStatus.tsx` | `0xCE959493...` (WP) | **Stale** | ✅ Updated to `0xC763...` |
| `frontend/client/src/sections/DevnetStatus.tsx` | `0x87319Da4...` (AR) | **Stale** | ✅ Updated to `0x7B4e...` |
| `frontend/client/src/sections/DevnetStatus.tsx` | `0x71930f07...` (MBV) | **Stale** | ✅ Updated to `0xF2BC...` |
| `frontend/client/src/sections/DevnetStatus.tsx` | Basescan link to old WP | **Stale** | ✅ Updated link |
| `app/.env.example` | `NEXT_PUBLIC_BASE_DEPOSIT_VERIFIER_ADDRESS=0x3F44...` | **Stale** | ✅ Updated to `0xbcC5...` |
| `app/.env.example` | `NEXT_PUBLIC_BASE_WITHDRAW_VERIFIER_ADDRESS=0xcb65...` | **Stale** | ✅ Updated to `0x7850...` |
| `app/.env.example` | `NEXT_PUBLIC_BASE_MERKLE_BATCH_VERIFIER_ADDRESS=0x7193...` | **Stale** | ✅ Updated to `0xF2BC...` |
| `README.md` | Table of 5 old addresses | **Stale** | ✅ Updated all 5 |
| `README.md` | Basescan links to old WP/AR | **Stale** | ✅ Updated links |
| `render.yaml` | `BASE_PROTOCOL_ADDRESS=0xCE9594...` | **Stale** | ✅ Updated to `0xC763...` |
| `docs/stealth-integration.md` | `0xCE959493...` | **Stale** | ✅ Updated to `0xC763...` |
| `docs/audits/supporting-chains-implementation-audit.md` | `0xCE959493...` | **Stale** | ✅ Updated to `0xC763...` |
| `docs/audits/supporting-chains-implementation-audit.md` | `0x87319Da4...` | **Stale** | ✅ Updated to `0x7B4e...` |
| `relayer/.env` | `BASE_PROTOCOL_ADDRESS=0xCE9594...` | **Stale** | ⚠️ Not modified (contains private key; outside allowed scope) |
| `docs/fixes/PR-003B-base-sepolia-redeploy-stealth-abi.md` | Old addresses listed | Historical | ✅ Intentionally kept for record |
| `chains/evm/broadcast/DeployWithAssets.s.sol/84532/run-*.json` | Old addresses | Historical | ✅ Kept as broadcast logs |

---

## 4. Stale References Updated

All active frontend/app/docs/config references have been updated to the new PR-003B deployment addresses. The only remaining stale reference is `relayer/.env` (local secrets file), which is outside the allowed modification scope for this PR and must be updated manually by the operator.

---

## 5. TypeScript E2E Root Cause

The pre-existing TS compilation issue was **simpler than described in PR-003B**:

- **`TS7016`** — `circomlibjs` ships no TypeScript declarations.
- **`TS5109`** — Only appeared when using `ts-node --transpile-only`; `ts-node` picked up `tsconfig.base.json` from the repo root which sets `module: "NodeNext"` without the matching `moduleResolution`.

**Actual blocker:** The E2E scripts (`chains/evm/test/e2e-base.ts`, `chains/evm/test/e2e-base-full.ts`) import `circomlibjs` and `ethers` v5, and `ts-node` refused to compile without type declarations.

**Why PR-003B couldn't run E2E:** `ts-node` failed before executing any on-chain logic.

---

## 6. TypeScript E2E Fix

Fix applied:

1. **Added local type declaration**  
   `chains/evm/test/types.d.ts`
   ```typescript
   declare module 'circomlibjs';
   ```

2. **Added E2E-specific tsconfig**  
   `chains/evm/tsconfig.e2e.json`
   ```json
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "commonjs",
       "moduleResolution": "node",
       "lib": ["ES2022"],
       "esModuleInterop": true,
       "strict": true,
       "skipLibCheck": true,
       "resolveJsonModule": true,
       "types": ["node"]
     },
     "include": ["test/**/*"]
   }
   ```

3. **Switched execution to `tsx`** (already installed in the repo)  
   `tsx` handles ESM/CJS interop without being affected by the repo's `tsconfig.base.json` or missing `.d.ts` files. This is the cleanest, most robust fix.

4. **Updated `chains/evm/package.json` scripts**
   ```json
   "test:e2e:base": "tsx test/e2e-base.ts",
   "test:e2e:base:full": "tsx test/e2e-base-full.ts"
   ```

**Verification:**
```bash
cd chains/evm && npx tsx test/e2e-base-full.ts
# Result: Compiles and runs; fails at on-chain deposit with "Invalid deposit proof"
# (this is a protocol bug, not a TS issue — see Section 9)
```

---

## 7. Commands Run

```bash
# Disk check
df -h
du -h -d 1 . | sort -h | tail -30

# Address audit
grep -r "0xCE959493..." --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" -l .

# Forge regression
cd chains/evm && forge build
cd chains/evm && forge test -vvv

# TS E2E compilation test
cd chains/evm && npx tsx test/e2e-base-full.ts

# On-chain state queries
cast call 0x7B4eD77809d1F54C6b8aE1d743b086471D488253 "getAssetId(address)" 0x0 --rpc-url https://sepolia.base.org
cast call 0x7B4eD77809d1F54C6b8aE1d743b086471D488253 "owner()" --rpc-url https://sepolia.base.org
```

---

## 8. Forge Build/Test Results

```
cd chains/evm && forge build
# Result: Compiled successfully (warnings only, no errors)

cd chains/evm && forge test -vvv
# Result: 55 tests passed, 0 failed, 0 skipped across 6 test suites
```

Note: Forge tests use **mock verifiers** (`MockVerifier`, `MockWithdrawVerifier`, `MockMerkleBatchVerifier`) that always return `true`. This is why they pass despite the real verifier field-prime check that blocks E2E.

---

## 9. Base Sepolia E2E Result

**Status: BLOCKED at Step A (Deposit)**

The TS environment was successfully fixed and the E2E script (`e2e-base-full.ts`) executes cleanly up to proof generation. The on-chain transaction then reverts with:

```
execution reverted: Invalid deposit proof
```

---

## 10. Deposit Evidence

**Attempt:** `e2e-base-full.ts` Step A — Deposit 0.001 ETH with real Groth16 proof.

**Error:**
```
❌ Deposit: FAILED - cannot estimate gas; transaction may fail or may require manual gas limit
  (error={"reason":"execution reverted: Invalid deposit proof","code":"UNPREDICTABLE_GAS_LIMIT",...})
```

**Root cause identified:** The `WhiteProtocol.deposit()` function builds public inputs as:
```solidity
uint256 assetId = uint256(assetRegistry.assetIds(token));
uint256[3] memory pubSignals = [commitment, amount, assetId];
```

For `token = address(0)`:
- `assetIds[address(0)] = keccak256(abi.encodePacked(address(0)))`
- Value = `0x5380c7b7ae81a58eb98d9c78de4a1fd7fd9535fc953ed2be602daaa41767312a`
- Decimal = `37769501256273667152911408316057893281707718534035493570029296695963585818922`

The BN254 scalar field prime is:
- `r = 21888242871839275222246405745257275088548364400416034343698204186575808495617`

Since `assetId > r`, the snarkJS-generated `DepositVerifier.sol` rejects the public input at its `checkField(v)` assembly guard, returning `false` and causing the contract to revert with `"Invalid deposit proof"`.

This affects **all** assets whose `keccak256(address) >= r`. On the current Base Sepolia deployment, both **ETH** and **WETH** fall into this category.

**Conclusion:** Deposit cannot succeed with real verifiers for any supported asset on the current deployment.

---

## 11. Settlement Evidence

**Not run.** Settlement (`settleBatch`) requires at least one successful deposit in the pending buffer. Since deposit is blocked, settlement cannot be tested end-to-end on the live deployment.

---

## 12. Withdraw Evidence

**Not run.** Withdraw requires a settled commitment in the Merkle tree. Since deposit is blocked, withdraw cannot be tested end-to-end on the live deployment.

---

## 13. Stealth Withdraw Evidence

**Not run.** Neither E2E script includes a stealth withdraw flow. Since the standard withdraw path is blocked, stealth withdraw is also blocked by the same root cause.

---

## 14. Rejection Test Evidence

The E2E script includes a double-spend rejection test (Step D), but it depends on a successful withdraw (Step C). Since Step C cannot run, the rejection test was not executed.

Separately, the on-chain stealth ABI rejection tests from PR-003B were re-confirmed:
- 33-byte `0x02` pubkey → accepted at calldata level (reverts at proof, not pubkey)
- 32-byte pubkey → reverts `Invalid ephemeral pubkey length`
- 33-byte `0x04` pubkey → reverts `Invalid ephemeral pubkey prefix`

---

## 15. Gas Usage Summary

No on-chain E2E transactions succeeded, so no E2E gas usage is available.

---

## 16. Contract Verification Result

**Status: SKIPPED**

`BASESCAN_API_KEY` is not configured in the environment:
- `chains/evm/.env` contains `BASESCAN_API_KEY=` (empty)
- Environment variable `BASESCAN_API_KEY` is not set

---

## 17. Basescan Verification — Exact Command to Run

Once `BASESCAN_API_KEY` is available, run:

```bash
export BASESCAN_API_KEY=<your_key>
cd chains/evm

# Verify WhiteProtocol
forge verify-contract \
  --chain-id 84532 \
  --compiler-version v0.8.20+commit.a1b79de6 \
  --etherscan-api-key $BASESCAN_API_KEY \
  0xC7632F1E2F38d1a16A9C451129a9d24edB10A265 \
  WhiteProtocol \
  --watch

# Verify AssetRegistry
forge verify-contract \
  --chain-id 84532 \
  --compiler-version v0.8.20+commit.a1b79de6 \
  --etherscan-api-key $BASESCAN_API_KEY \
  0x7B4eD77809d1F54C6b8aE1d743b086471D488253 \
  AssetRegistry \
  --watch

# Verify DepositVerifier
forge verify-contract \
  --chain-id 84532 \
  --compiler-version v0.8.20+commit.a1b79de6 \
  --etherscan-api-key $BASESCAN_API_KEY \
  0xbcC566af14aDC6a7872Fb99379148F86Eb807394 \
  Groth16Verifier \
  --watch

# Verify WithdrawVerifier
forge verify-contract \
  --chain-id 84532 \
  --compiler-version v0.8.20+commit.a1b79de6 \
  --etherscan-api-key $BASESCAN_API_KEY \
  0x78508a36ceE77c9171A6B7963175b369834D9F21 \
  Groth16Verifier \
  --watch

# Verify MerkleBatchVerifier
forge verify-contract \
  --chain-id 84532 \
  --compiler-version v0.8.20+commit.a1b79de6 \
  --etherscan-api-key $BASESCAN_API_KEY \
  0xF2BCD1aF0B70fF9c206d5e2059f98F9c9148470C \
  Groth16Verifier \
  --watch
```

Note: `DepositVerifier.sol`, `WithdrawVerifier.sol`, and `MerkleBatchVerifier.sol` each contain a contract named `Groth16Verifier`. If Foundry needs the source file name, use `src/DepositVerifier.sol:Groth16Verifier` etc.

---

## 18. Files Changed

| File | Change |
|------|--------|
| `frontend/client/src/sections/DevnetStatus.tsx` | Updated 3 old contract addresses + Basescan link to new deployment |
| `app/.env.example` | Updated 3 old verifier addresses to new deployment |
| `README.md` | Updated 5 old contract addresses + 2 Basescan links |
| `render.yaml` | Updated `BASE_PROTOCOL_ADDRESS` to new deployment |
| `docs/stealth-integration.md` | Updated Base Sepolia contract address |
| `docs/audits/supporting-chains-implementation-audit.md` | Updated 2 old addresses in support matrix and evidence section |
| `chains/evm/test/types.d.ts` | Added `declare module 'circomlibjs'` for IDE/TS support |
| `chains/evm/tsconfig.e2e.json` | Added dedicated tsconfig for E2E test compilation |
| `chains/evm/package.json` | Added `test:e2e:base`, `test:e2e:base:full`, and `verify:base-sepolia` scripts |

---

## 19. Remaining Blockers

| Blocker | Severity | Detail |
|---------|----------|--------|
| **Asset ID > BN254 field prime** | **Critical** | `AssetRegistry` stores `keccak256(token)` as `bytes32`, and `WhiteProtocol` casts it directly to `uint256` for the verifier. For ETH (`address(0)`) and WETH on Base Sepolia, this value exceeds the BN254 scalar field prime `r`. The snarkJS-generated verifier explicitly rejects any public input `>= r`. This blocks **all** deposit, withdraw, and stealth-withdraw E2E tests against the real verifiers. |
| `relayer/.env` stale address | Low | `BASE_PROTOCOL_ADDRESS` still points to old contract. File contains secrets and was not in allowed scope. Operator must update manually. |
| Basescan verification | Low | `BASESCAN_API_KEY` not available. Exact commands documented in Section 17. |

---

## 20. Final Base Sepolia Status

**Base Sepolia E2E still failing**

The environment is clean, compilation works, and the deployment is correctly referenced everywhere. However, a **pre-existing protocol bug** (asset ID encoding exceeds the BN254 field prime) prevents any ZK proof from passing real verifier checks for ETH or WETH on the current deployment.

This bug was **not introduced by PR-003/003B**; it was masked because:
1. Forge unit tests use mock verifiers that always return `true`.
2. PR-003B smoke checks were read-only (no proof verification).
3. The TS compilation issue prevented anyone from reaching the on-chain proof verification step.

---

## 21. Next Recommended Step

1. **Fix the asset ID field-prime bug in protocol logic**  
   Options:
   - Modify `AssetRegistry.addAsset()` to store `keccak256(token) % FIELD_PRIME` instead of raw `keccak256(token)`.
   - Or modify `WhiteProtocol.deposit/withdraw/withdrawStealth()` to reduce `assetId` modulo `FIELD_PRIME` before passing it to the verifier.
   - Ensure `@thewhiteprotocol/core` TypeScript `computeAssetId()` matches the on-chain logic exactly.

2. **Redeploy Base Sepolia** with the fix, using real verifiers.

3. **Re-run full E2E** (`npm run test:e2e:base:full`) against the new deployment.

4. **Run Basescan verification** once `BASESCAN_API_KEY` is available (commands in Section 17).

5. **Update `relayer/.env`** with the new `BASE_PROTOCOL_ADDRESS` (operator action).

---

*Report generated: 2026-04-30*
