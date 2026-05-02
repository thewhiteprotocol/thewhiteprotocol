# PR-005D — Promote Base Sepolia v2 Deployment to Active Testnet Configuration

**Title:** Promote verified Base Sepolia v2 to active deployment artifact and update all active consumers  
**Date:** 2026-05-02  
**Status:** ✅ Complete

---

## 1. Summary

PR-005D promotes the verified Base Sepolia v2 deployment (from PR-005C) to the active testnet configuration used by the app, frontend, relayer defaults, and documentation. The legacy v1 artifact is preserved unchanged. All active code references are updated to point to the v2 contracts with domain-separated asset IDs.

---

## 2. Why v2 Promotion Was Needed

PR-005B introduced the v2 asset ID formula with protocol-scoped domain separation. PR-005C deployed and verified v2 on Base Sepolia with real Groth16 verifiers. PR-005D makes that verified deployment the canonical active testnet configuration so that:

- New app/frontend builds use v2 addresses by default.
- Relayer fallback defaults point to v2.
- Documentation reflects the current live deployment.
- E2E tests run against the active v2 artifact.

The v1 deployment remains accessible as a legacy backup for any existing integrations that have not yet migrated.

---

## 3. v1 Artifact Preserved Path

`chains/evm/deployments/base-sepolia-v1-backup.json`

- WhiteProtocol: `0xAc0ae70cd63C98d23858a81aa0860213cb4CcBd0`
- AssetRegistry: `0x568aD2F600011E343a4EC53F8C7b9b8eDC6173b4`
- domainId: 0 (implicit v1)
- assetIdVersion: 1
- Status: Legacy / preserved

---

## 4. v2 Artifact Path

`chains/evm/deployments/base-sepolia-v2.json`

- WhiteProtocol: `0x396e539bCDeAF48ab9526A13c6E688CBA69C059a`
- AssetRegistry: `0xc2508F03c42B11b79ef4aA979b9FfA7f62D003B7`
- domainId: 33554434 (`0x02000002`)
- assetIdVersion: 2
- Status: Verified (PR-005C)

---

## 5. Active Artifact Path

`chains/evm/deployments/base-sepolia.json`

This file is now a copy of the v2 artifact with additional metadata:

```json
{
  "active": true,
  "generation": "PR-005C",
  "previousArtifact": "deployments/base-sepolia-v1-backup.json",
  "domainIdHex": "0x02000002",
  "assetIdFormula": "white:asset_id:v2",
  "verifiedE2E": true,
  "notes": "Active Base Sepolia testnet deployment with v2 domain-separated asset IDs"
}
```

---

## 6. Active Base Sepolia Addresses

| Contract | Address |
|----------|---------|
| WhiteProtocol | `0x396e539bCDeAF48ab9526A13c6E688CBA69C059a` |
| AssetRegistry | `0xc2508F03c42B11b79ef4aA979b9FfA7f62D003B7` |
| DepositVerifier | `0xD566bdec3263476B453DBFE7AAE1c6E2123E90C5` |
| WithdrawVerifier | `0x8Bb36a8F6ccE6439899eB5f025E8bF532c938233` |
| MerkleBatchVerifier | `0x818E535D774F329dfE9Cdf8C95F8ff7Ee85c822B` |

---

## 7. Domain ID and Asset ID Version

| Property | Value |
|----------|-------|
| domainId | 33554434 |
| domainIdHex | `0x02000002` |
| assetIdVersion | 2 |
| assetIdFormula | `white:asset_id:v2` |

---

## 8. Files Updated

| File | Change |
|------|--------|
| `chains/evm/deployments/base-sepolia.json` | Promoted to active v2 artifact with metadata |
| `app/src/config/base.ts` | Updated fallback defaults to v2 addresses |
| `app/.env.example` | Updated example env vars to v2 addresses |
| `frontend/client/src/sections/DevnetStatus.tsx` | Updated displayed Base Sepolia addresses |
| `render.yaml` | Updated `BASE_PROTOCOL_ADDRESS` |
| `relayer/src/index.ts` | Updated fallback `baseProtocolAddress` default |
| `relayer/.env.example` | Updated `BASE_PROTOCOL_ADDRESS` example |
| `README.md` | Updated Base Sepolia deployment table and explorer links |
| `docs/stealth-integration.md` | Updated Base Sepolia contract address |
| `chains/evm/package.json` | Updated `verify:base-sepolia` command + added E2E scripts |
| `chains/evm/test/e2e-base.ts` | Made artifact-aware (reads active deployment) |

**Files NOT changed:**
- `chains/evm/deployments/base-sepolia-v1-backup.json` — preserved as legacy
- `chains/evm/deployments/base-sepolia-v2.json` — preserved as verified shadow
- Historical fix reports (`docs/fixes/PR-00*.md`)
- Audit reports (`docs/audits/*.md`)
- Broadcast logs
- `relayer/.env` — contains secrets, operator action documented instead

---

## 9. Stale Address Audit Result

**Search pattern:** `0xAc0ae70cd63C98d23858a81aa0860213cb4CcBd0` and `0x568aD2F600011E343a4EC53F8C7b9b8eDC6173b4`

| File | Old Address | Status | Action |
|------|-------------|--------|--------|
| `app/src/config/base.ts` | v1 | Stale active | ✅ Updated to v2 |
| `app/.env.example` | v1 | Stale active | ✅ Updated to v2 |
| `frontend/client/src/sections/DevnetStatus.tsx` | v1 | Stale active | ✅ Updated to v2 |
| `render.yaml` | v1 | Stale active | ✅ Updated to v2 |
| `relayer/src/index.ts` | v1 | Stale active fallback | ✅ Updated to v2 |
| `relayer/.env.example` | even older | Stale active example | ✅ Updated to v2 |
| `README.md` | v1 | Stale active | ✅ Updated to v2 |
| `docs/stealth-integration.md` | v1 | Stale active | ✅ Updated to v2 |
| `chains/evm/package.json` | v1 | Stale verify command | ✅ Updated to v2 |
| `chains/evm/test/e2e-base.ts` | v1 | Stale active | ✅ Made artifact-aware |
| `docs/fixes/PR-004*.md` | v1 | Historical | ⏭️ Preserved (historical report) |
| `docs/fixes/PR-005A*.md` | v1 | Historical | ⏭️ Preserved (historical report) |
| `docs/audits/*.md` | v1 | Historical | ⏭️ Preserved (historical audit) |
| `chains/evm/broadcast/` | v1 | Broadcast logs | ⏭️ Preserved |
| `chains/evm/deployments/base-sepolia-v1-backup.json` | v1 | Legacy artifact | ⏭️ Preserved |

**No stale active references remain.**

---

## 10. Relayer `.env` Manual Operator Action

**File:** `relayer/.env` was **NOT modified** because it contains secrets (`BASE_DEPLOYER_PRIVATE_KEY`, `SEQUENCER_WALLET`).

**Operator action required:**

```bash
# In relayer/.env, update:
BASE_PROTOCOL_ADDRESS=0x396e539bCDeAF48ab9526A13c6E688CBA69C059a
```

The fallback default in `relayer/src/index.ts` has been updated, so if `BASE_PROTOCOL_ADDRESS` is not set in `.env`, the relayer will now default to the v2 contract. Explicit configuration is still recommended.

---

## 11. Commands Run

```bash
# Forge build
cd chains/evm && forge build

# Forge tests
cd chains/evm && forge test -vvv

# Core tests
cd packages/core && npm test

# Active E2E attempt
cd chains/evm && npm run test:e2e:base:full
```

---

## 12. Forge Build / Test Results

| Command | Result |
|---------|--------|
| `forge build` | ✅ OK |
| `forge test` | ✅ 70/70 passed |

---

## 13. TypeScript / Core Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| TypeScript Core (vitest) | 26 | ✅ 26 passed |

---

## 14. Active Base Sepolia E2E Result

**Deposit:** ✅ PASSED  
- Tx: `0x23aabbb16a5b607c1bce42eb58419c7e9a9a3ea30f0fceb1ee05211b74f51fc0`
- Asset ID v2 matched on-chain

**Settlement:** ❌ BLOCKED  
- The v2 contract already has tree state from the PR-005C E2E run (`nextLeafIndex=1`).
- The `e2e-base-full.ts` script computes Merkle paths assuming an empty tree (all-zero siblings), which is only valid for `startIndex=0`.
- Circuit assertion failed at `MerkleBatchUpdate_183 line: 161` because the path elements did not match the actual tree state.

**Withdraw & Double-spend:** ⏭️ Skipped (depends on settlement)

**Why this is NOT a regression:**
- PR-005C already proved full `deposit → settle → withdraw → double-spend rejection` on this exact contract when the tree was empty.
- The promotion (PR-005D) changes only references/artifacts, not contracts or circuits.
- Re-running E2E on a non-empty tree requires off-chain Merkle tree state tracking, which is out of scope.

**Prior proof:** See `docs/fixes/PR-005C-base-sepolia-v2-e2e.md` for the complete v2 E2E evidence.

---

## 15. Basescan Verification Result or Commands

**Status:** Not executed (no `BASESCAN_API_KEY` configured)

**Verify commands for operator:**

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

---

## 16. Remaining Blockers

| Blocker | Impact | Mitigation |
|---------|--------|------------|
| E2E cannot rerun on non-empty tree | Cannot re-prove full cycle on same contract | PR-005C evidence is prior proof; future E2E needs fresh deploy or tree-state tracking |
| No `BASESCAN_API_KEY` | Contracts not verified on Basescan | Operator can run commands above |
| `relayer/.env` not updated | Relayer may use old address if env var is explicitly set | Operator must update `BASE_PROTOCOL_ADDRESS` manually |

---

## 17. Final Active Base Sepolia Status

| Criterion | Status |
|-----------|--------|
| `base-sepolia.json` points to verified v2 | ✅ |
| `base-sepolia-v1-backup.json` preserves v1 | ✅ |
| Active app/frontend/config references point to v2 | ✅ |
| `relayer/.env` not modified (secrets preserved) | ✅ |
| Operator action documented | ✅ |
| Forge tests pass | ✅ 70/70 |
| Core tests pass | ✅ 26/26 |
| Deposit proven against active artifact | ✅ |
| Settlement blocked by tree state (documented) | ⏭️ Known limitation |
| Prior E2E proof exists (PR-005C) | ✅ |
| No secrets printed or committed | ✅ |

---

## 18. Next Recommended Step

1. **Set `BASESCAN_API_KEY`** and run the verify commands in section 15.
2. **Update `relayer/.env`** manually with `BASE_PROTOCOL_ADDRESS=0x396e539bCDeAF48ab9526A13c6E688CBA69C059a`.
3. **Make `e2e-base-full.ts` tree-state aware** if repeated E2E runs on the same contract are needed (track siblings off-chain after each settlement).
4. **Deploy a fresh v2 instance** if a clean E2E rerun is required before mainnet.
5. **When ready for mainnet:** apply the same promotion pattern (`base-mainnet.json` with v2 domain ID `0x02000007`).

---

*PR-005D — Privacy, Pure and Simple.*
