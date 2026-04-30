# PR-003B — Base Sepolia Redeploy After Stealth Pubkey ABI Fix

## 1. Summary

PR-003 changed the EVM stealth withdrawal ephemeral pubkey type from `bytes32` to `bytes calldata` (33-byte compressed secp256k1) in `WhiteProtocol.sol`. This ABI change made the previous Base Sepolia deployment incompatible with the updated TypeScript core/relayer/app stack. PR-003B redeployed the full protocol suite to Base Sepolia using real Groth16 verifiers, updated all consumer configs, verified the new stealth ABI on-chain, and ran smoke checks.

---

## 2. Why Redeploy Was Needed

| Aspect | Before PR-003 | After PR-003 | Impact |
|--------|---------------|--------------|--------|
| Solidity param | `bytes32 ephemeralPubkey` | `bytes calldata ephemeralPubkey` | Existing contract rejects 33-byte pubkeys |
| Event | `bytes32 indexed ephemeralPubkey` | `bytes ephemeralPubkey` | Event topic hashing changed |
| Validation | `!= bytes32(0)` | `length == 33 && (0x02 \|\| 0x03)` | Old contract has no length/prefix checks |
| Relayer ABI | `bytes32` in parseAbi | `bytes` in parseAbi | ABI mismatch would cause tx encoding failure |
| App/core | Generates 33-byte compressed keys | Still 33 bytes | Would be rejected by old contract |

Any call to `withdrawStealth` with a valid 33-byte compressed secp256k1 pubkey against the old deployment (`0xCE9594...`) would encode the `bytes` argument as a dynamic type, but the old contract expects a fixed 32-byte word, causing calldata misalignment and unpredictable behavior.

---

## 3. Old Base Sepolia Addresses

```json
{
  "WhiteProtocol": "0xCE959493cf6F15314b4B9eEbb28369716341e7FE",
  "AssetRegistry": "0x87319Da4558FcBD4f3475cFECc468ee4D736D3ea",
  "DepositVerifier": "0x3F44E947d9f9F0055854aF678F03C32F4bbd415e",
  "WithdrawVerifier": "0xcb657012d8a718EA8FC51E68cC729d923f023E59",
  "MerkleBatchVerifier": "0x71930f07b3bA75A314a6e7c44C350AD0E2718473"
}
```

---

## 4. New Base Sepolia Addresses

```json
{
  "WhiteProtocol": "0xC7632F1E2F38d1a16A9C451129a9d24edB10A265",
  "AssetRegistry": "0x7B4eD77809d1F54C6b8aE1d743b086471D488253",
  "DepositVerifier": "0xbcC566af14aDC6a7872Fb99379148F86Eb807394",
  "WithdrawVerifier": "0x78508a36ceE77c9171A6B7963175b369834D9F21",
  "MerkleBatchVerifier": "0xF2BCD1aF0B70fF9c206d5e2059f98F9c9148470C"
}
```

- **Chain ID:** 84532
- **Deployer:** `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`
- **Deployed at:** 2026-04-30T12:50:38Z
- **Deployment artifact:** `chains/evm/deployments/base-sepolia.json`

---

## 5. Deployment Script Used

- **Script:** `chains/evm/script/Deploy.s.sol`
- **Command:** `NETWORK=base-sepolia forge script script/Deploy.s.sol --ffi --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast`
- **No `--verify`:** Basescan API key not configured in this environment; verification skipped but deployment succeeded.

---

## 6. Confirmation That Real Verifiers Were Used

| Check | Result |
|-------|--------|
| `Deploy.s.sol` deploys `DepositVerifier.sol:Groth16Verifier` via `_deployBytecode` | ✅ Yes |
| `Deploy.s.sol` deploys `WithdrawVerifier.sol:Groth16Verifier` | ✅ Yes |
| `Deploy.s.sol` deploys `MerkleBatchVerifier.sol:Groth16Verifier` | ✅ Yes |
| Mock verifiers (`MockDepositVerifier`, etc.) used? | ❌ No — `DeployWithAssets.s.sol` contains mocks but was NOT used |
| On-chain verifier code exists at deployed addresses | ✅ Verified via `cast code` |
| Constructor wiring matches deployed addresses | ✅ Verified via `cast call` to `depositVerifier()`, `withdrawVerifier()`, `merkleBatchVerifier()` |

---

## 7. Build/Test Results

```
cd chains/evm && forge build
# Result: compiled successfully (warnings only, no errors)

cd chains/evm && forge test -vvv
# Result: 55 tests passed, 0 failed, 0 skipped across 6 test suites
```

All StealthWithdrawal tests pass with the new `bytes` type:
- `test_StealthWithdrawalEvent02` (0x02 prefix)
- `test_StealthWithdrawalEvent03` (0x03 prefix)
- `test_StealthWithdrawalRejects32Bytes`
- `test_StealthWithdrawalRejects34Bytes`
- `test_StealthWithdrawalRejects33BytesInvalidPrefix`
- `test_StealthWithdrawalRejects33BytesZeroPrefix`
- `test_StealthWithdrawalRejectsEmptyBytes`
- `test_StealthWithdrawalDoubleSpend`

---

## 8. Wallet/Env Readiness

| Item | Value / Status |
|------|----------------|
| Deployer address | `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c` |
| Pre-deploy balance | ~0.0725 ETH |
| Deployment cost | ~0.000141 ETH |
| Post-deploy balance | ~0.0724 ETH (sufficient) |
| `DEPLOYER_PRIVATE_KEY` | Present in `chains/evm/.env` |
| `BASE_SEPOLIA_RPC_URL` | Present and responsive |
| `BASESCAN_API_KEY` | Not configured (verification skipped) |
| Chain ID check | 84532 ✅ |
| Nonce | 101 (before deploy) |

---

## 9. Deployment Transaction Hashes

| Contract / Action | Tx Hash |
|-------------------|---------|
| DepositVerifier (Groth16Verifier) | `0x5dbd0e0bf9bccc3f9d32e7986b3a0fdadfed816c6a84ed222b84892db0f7fdb0` |
| WithdrawVerifier (Groth16Verifier) | `0x63d5f3aa846350e5689624b2816cd768bf51e1edcc00db7ab2bec7709fd6cc67` |
| MerkleBatchVerifier (Groth16Verifier) | `0x84c8d8177d3ead14f0a30f3dcf22b064d7e905ef112060ef65e2e1decc4ae548` |
| AssetRegistry | `0x30369a56c503798b5b767384f2e9f52706316d01c351cd63f9a3e0079928c8de` |
| WhiteProtocol | `0x738fb2da2544c50df11ed3c338b022f73820e02e4ed15f9bea347e1e0d7197a1` |
| AssetRegistry.transferOwnership(WhiteProtocol) | `0xeaf1a1676cec7d3c1b6d2acd853537d46656f4d45488b9274917ef04330fd363` |
| WhiteProtocol.addSupportedAsset(native) | `0xcff73d2687b8a8dbe2e3a2afbb4b95704d4cfb0f3655d568f1181c4c6e3c0a31` |
| WhiteProtocol.addSupportedAsset(WETH) | `0xeef87960e553c1b1e5a0e47da72561b2247495a8ba18929e86a6941fed80f99f` |
| WhiteProtocol.registerRelayer(deployer) | `0xe15ad7ba6614ec0c6cb6cf1b515a2f06711f128dd9722b6095fd54e48c7f87ec` |

---

## 10. Deployment Artifact Changes

- **`chains/evm/deployments/base-sepolia.json`** — overwritten with new addresses, timestamp, and merkle state.
- **`chains/evm/broadcast/Deploy.s.sol/84532/run-latest.json`** — generated by Foundry with full broadcast trace.
- Old broadcast logs (`run-1776041141222.json` from `DeployWithAssets.s.sol`) remain in repo for historical reference.

---

## 11. Relayer/App Config Changes

### Updated Files

| File | Change |
|------|--------|
| `app/src/config/base.ts` | Updated all 5 fallback addresses to new deployment |
| `app/.env.example` | Updated `NEXT_PUBLIC_BASE_PROTOCOL_ADDRESS` and `NEXT_PUBLIC_BASE_ASSET_REGISTRY_ADDRESS` |
| `relayer/src/index.ts` | Updated fallback `BASE_PROTOCOL_ADDRESS` default |
| `relayer/.env.example` | Updated `BASE_PROTOCOL_ADDRESS` example |
| `relayer/src/chains/evm.ts` | ABI: `bytes32 ephemeralPubkey` → `bytes ephemeralPubkey` (PR-003) |
| `relayer/src/chains/base.ts` | ABI: same update as `evm.ts` (PR-003) |
| `relayer/src/index.ts` | Validation: 64 hex → 66 hex + prefix check (PR-003) |
| `chains/evm/test/e2e-base.ts` | Updated hardcoded `whiteProtocol` and `assetRegistry` addresses |
| `chains/evm/test/e2e-base-full.ts` | Updated hardcoded `whiteProtocol` address |

### Not Updated (Out of Scope)

- `frontend/client/src/sections/DevnetStatus.tsx` — UI component, outside allowed scope
- `README.md` — documentation, would be updated in a docs pass
- `docs/stealth-integration.md` — references old address
- `render.yaml` — infrastructure config

---

## 12. Smoke Checks Run

### On-Chain Read-Only Verification

| Check | Method | Result |
|-------|--------|--------|
| WhiteProtocol code exists | `cast code` | ✅ 100+ bytes deployed |
| AssetRegistry code exists | `cast code` | ✅ 100+ bytes deployed |
| Empty root matches expected | `getLastRoot()` | ✅ `0x2134e76a...` |
| nextLeafIndex is 0 | `nextLeafIndex()` | ✅ `0` |
| ETH is supported | `isSupported(0x0)` | ✅ `true` |
| WETH is supported | `isSupported(WETH)` | ✅ `true` |
| Deployer is relayer | `isRelayer(deployer)` | ✅ `true` |
| AssetRegistry owner is WP | `owner()` | ✅ `0xC763...` |
| DepositVerifier wired | `depositVerifier()` | ✅ `0xbcC5...` |
| WithdrawVerifier wired | `withdrawVerifier()` | ✅ `0x7850...` |
| MerkleBatchVerifier wired | `merkleBatchVerifier()` | ✅ `0xF2BC...` |

---

## 13. Stealth ABI Verification Result

Three on-chain call tests were executed against the new `WhiteProtocol` contract using `cast send`:

| Test | Pubkey | Expected Revert | Actual Result |
|------|--------|-----------------|---------------|
| Valid 33-byte (0x02) | `0x021234...abcdef` | Proof validation (not pubkey) | ❌ `Invalid proof length` → **pubkey accepted** ✅ |
| Invalid 32-byte | `0x123456...abcdef` (32 bytes) | `Invalid ephemeral pubkey length` | ❌ `Invalid ephemeral pubkey length` ✅ |
| Invalid 33-byte prefix (0x04) | `0x041234...abcdef` | `Invalid ephemeral pubkey prefix` | ❌ `Invalid ephemeral pubkey prefix` ✅ |

**Conclusion:** The on-chain contract correctly:
1. Accepts 33-byte compressed secp256k1 pubkeys with prefix `0x02`
2. Rejects 32-byte pubkeys with length error
3. Rejects 33-byte pubkeys with invalid prefix (`0x04`)

The function selector for `withdrawStealth(bytes,uint256,uint256,address,address,uint256,uint256,address,bytes)` is `0xa79f8683`, confirming the ABI change from the old `bytes32` signature.

---

## 14. Full E2E Result

**Not run.**

---

## 15. Why Full E2E Was Not Run

The existing TypeScript E2E scripts (`test/e2e-base-full.ts`, `test/e2e-base.ts`) could not execute due to **pre-existing environment issues unrelated to PR-003/003B**:

1. **`TS7016`** — `circomlibjs` has no TypeScript declaration file.
2. **`TS5109`** — The repo's `tsconfig.json` uses `"module": "NodeNext"` without `"moduleResolution": "NodeNext"`, causing `ts-node` to fail even with `--transpile-only`.

These are repo-level TypeScript/Node configuration issues that existed before this PR. Fixing them would require:
- Adding `declare module 'circomlibjs';` to a `.d.ts` file, OR
- Updating `tsconfig.json` module resolution settings, OR
- Running the E2E via a different build pipeline (e.g., compiled JS).

None of these are in scope for PR-003B. The smoke checks and ABI-level stealth tests above provide sufficient coverage for the redeploy.

---

## 16. Remaining Blockers

| Blocker | Severity | Note |
|---------|----------|------|
| Basescan contract verification | Low | Contracts deployed but not verified on Basescan; add `BASESCAN_API_KEY` and re-run with `--verify` |
| Frontend/docs address references | Low | `DevnetStatus.tsx`, `README.md`, `docs/stealth-integration.md` still show old addresses; update in a docs/UI pass |
| E2E TS compilation | Medium | Pre-existing; blocks automated deposit→settle→withdraw E2E on Base Sepolia |
| Relayer Solana type error | Low | Pre-existing `AnchorWallet`/`Wallet` type mismatch in `relayer/src/chains/solana.ts`; unrelated to EVM |

---

## 17. Final Base Sepolia Status

| Item | Status |
|------|--------|
| Contracts deployed with updated stealth ABI | ✅ **LIVE** |
| Real Groth16 verifiers used | ✅ Confirmed |
| Deployment artifact updated | ✅ `chains/evm/deployments/base-sepolia.json` |
| Core protocol smoke checks | ✅ 11/11 passed |
| Stealth ABI validation on-chain | ✅ 3/3 passed |
| Forge tests | ✅ 55/55 passed |
| Relayer ABI updated | ✅ `bytes ephemeralPubkey` |
| App fallback addresses updated | ✅ |
| Stale `bytes32 ephemeralPubkey` references | ✅ Zero remaining in code |
| Full deposit→settle→withdraw E2E | ❌ Not run (pre-existing TS env issue) |
| Contract verification on Basescan | ❌ Not done (missing API key) |

---

## 18. Next Recommended Step

1. **Verify contracts on Basescan** (optional but recommended):
   ```bash
   export BASESCAN_API_KEY=...
   cd chains/evm
   forge verify-contract --chain-id 84532 --compiler-version v0.8.20 \
     0xC7632F1E2F38d1a16A9C451129a9d24edB10A265 WhiteProtocol
   ```

2. **Update frontend/docs addresses** in a follow-up docs/UI PR:
   - `frontend/client/src/sections/DevnetStatus.tsx`
   - `README.md`
   - `docs/stealth-integration.md`
   - `render.yaml`

3. **Fix E2E TypeScript environment** so `ts-node test/e2e-base-full.ts` can run:
   - Add `chains/evm/test/types.d.ts` with `declare module 'circomlibjs';`
   - Or align `tsconfig.json` module settings for the E2E scripts.

4. **Run full E2E** once the TS env is fixed:
   ```bash
   cd chains/evm
   npx ts-node test/e2e-base-full.ts
   ```

5. **Run a stealth-specific E2E** that calls `withdrawStealth` with a real 33-byte compressed pubkey and valid proof to confirm end-to-end stealth withdrawals work on Base Sepolia.
