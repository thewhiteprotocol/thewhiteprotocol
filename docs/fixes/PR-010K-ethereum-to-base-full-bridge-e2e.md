# PR-010K: Ethereum Sepolia → Base Sepolia Full Private Bridge E2E (Reverse Direction)

## 1. Summary

PR-010K proves the **reverse direction** of the EVM↔EVM private bridge: **Ethereum Sepolia → Base Sepolia**. A source note is deposited on Ethereum, settled into the Ethereum Merkle tree, bridged out via `bridgeOutV1` (with ZK proof binding), threshold-signed by 2-of-3 attestors, accepted into Base Sepolia via `acceptBridgeMint`, and finally withdrawn on Base using a standard ZK withdraw proof.

This complements PR-010I/PR-010J (Base → Ethereum) by proving the bridge works bidirectionally.

**What was proven:**
- Ethereum Sepolia source note can be deposited, settled, and spent via `bridgeOutV1`
- `bridgeOutV1` atomically verifies ZK withdraw proof, marks nullifier spent, and emits `BridgeOutInitiated`
- 2-of-3 threshold ECDSA signatures over raw message hash validate on Base Sepolia
- `BridgeInbox.acceptBridgeMint` inserts destination commitment into Base Merkle tree
- Bridge-minted commitment on Base can be withdrawn with standard Groth16 proof
- Duplicate bridge message replay rejected (`MessageAlreadyConsumed`)
- Duplicate destination withdraw/nullifier replay rejected (`Nullifier already spent`)
- Direct `BridgeOutbox.initBridgeOut` bypass is gated (only callable by `WhiteProtocol`)

**What was NOT proven yet:**
- Solana ↔ EVM route
- BNB Chain / Polygon Amoy routes
- Automated daemonized relayer mode
- Mainnet readiness

---

## 2. Why Reverse Direction Required Configuration Fixes

The Base → Ethereum direction (PR-010I/PR-010J) used:
- Base WP (PR-010H, has `bridgeOutV1`) as **source**
- Ethereum WP (PR-010G, lacks `bridgeOutV1`) as **destination**

For Ethereum → Base, the roles reverse. The Ethereum WP needed to be redeployed with `bridgeOutV1` support. This uncovered several configuration issues:

### a. Ethereum WP Redeploy
- Old Ethereum WP (`0x5813d68a...`) lacked `bridgeOutV1` / `bridgeCommitments`
- New Ethereum WP (`0xB6376557...`) deployed with current PR-010H code
- BridgeOutbox redeployed and wired to new WP

### b. Base BridgeInbox `whiteProtocol` Misconfigured
- Base BridgeInbox (`0x4D4aDB46...`) had `whiteProtocol` set to `0x396e539b...` — an old/incorrect contract
- Correct Base WP is `0xb2e296a9...`
- Fix: `setWhiteProtocol(0xb2e296a9D69e27F43d400aF2942Fb15F1b31750b)` tx executed

### c. Base BridgeInbox Asset Support
- Base BridgeInbox did not recognize Ethereum's canonical asset ID (`0x002eedb1...`)
- Fix: `supportAsset(0x002eedb1...)` + `setLocalAsset(0x002eedb1..., 0x0000...)` executed

### d. Base Deployer Underfunded
- After multiple test runs, Base Sepolia deployer balance dropped to ~0.00125 ETH
- `acceptBridgeMint` gas cost (~1M gas @ 1.5 gwei) exceeded available funds
- Fix: bridged 0.005 ETH from Ethereum Sepolia via Base L1StandardBridge (`0xfd0Bf71F...`)

---

## 3. E2E Route

```
Ethereum Sepolia                                    Base Sepolia
────────────────                                    ────────────
Deposit ETH
    ↓
Settle into Merkle tree
    ↓
Generate bridge withdraw proof
    ↓
bridgeOutV1 (spend source note, emit BridgeOutInitiated)
    ↓
Wait finality (3 blocks)
    ↓
2-of-3 threshold signatures
    ↓
                        ───► acceptBridgeMint
                                ↓
                        bridgeMint → insert commitment
                                ↓
                        Generate destination withdraw proof
                                ↓
                        WhiteProtocol.withdraw
                                ↓
                        Recipient receives ETH
```

---

## 4. Ethereum Deposit Evidence

| Parameter | Value |
|---|---|
| Network | Ethereum Sepolia |
| Amount | 0.001 ETH |
| Tx Hash | `0xfc4d04493576d514410dcf07ed8638e35907392b7715b28b84f66d084259cd5b` |
| Contract | `0xB63765574b4722486c354c29953597B5108c713f` |

Deposit succeeded with valid Groth16 deposit proof. Commitment queued in `pendingDeposits`.

---

## 5. Ethereum Settlement Evidence

| Parameter | Value |
|---|---|
| Tx Hash | `0xee5480003968535da6f80190e1f4ffa03f49ee624dae9f101cdbe405f2d79e35` |
| Circuit | `merkle_batch_update` |
| Batch size | 1 |

Merkle root updated on-chain. Source commitment now at a known `leafIndex` in the Ethereum Merkle tree.

---

## 6. bridgeOutV1 Evidence

| Parameter | Value |
|---|---|
| Tx Hash | `0x14d1fda8ddb98d9c2a498ff4a23eea34d8754154af8c293f2d914a14ad72131e` |
| Gas used | 545,315 |
| Source leaf index | 8 |
| Source nullifier hash | `0x188f43d28fb4ffd81c8b1dfc9a03ac6c831c2b79a9597793287bf23bb0e45dea` |

`bridgeOutV1` atomically:
- Verified ZK withdraw proof with `recipient = BridgeOutbox` and `publicDataHash = messageHash % BN254_SCALAR_FIELD`
- Marked source nullifier as spent
- Emitted `BridgeOut` event on `WhiteProtocol`
- Emitted `BridgeOutInitiated` event on `BridgeOutbox`

---

## 7. acceptBridgeMint Evidence

| Parameter | Value |
|---|---|
| Network | Base Sepolia |
| Tx Hash | `0x3d964bbe553c2d9be41e4848d3b859c4de0add4ff73608157398f0d8f53b2abb` |
| Gas used | 983,577 |
| Signatures | 2-of-3 sorted secp256k1 |
| Signer set version | 1 |

`BridgeInbox.acceptBridgeMint`:
- Verified threshold ECDSA signatures over raw message hash (no EIP-191 prefix)
- Checked route enabled, asset supported, caps not exceeded, deadline not expired
- Verified message not already consumed
- Called `WhiteProtocol.bridgeMint` which directly inserted the destination commitment into the Base Merkle tree
- Emitted `BridgeMintAccepted` event

---

## 8. Destination Commitment Insertion Evidence

| Parameter | Value |
|---|---|
| Pre-state root | `0x12d4e9cfe7cd21c548c78dca49389cb1a9a2fa3d394efae7c53d6475bdb5aebf` |
| Post-state root | `0x07758b35942f9cb0f0df5de5ed9d9eeb325f19a3a633ad95f9d48dd9c8710354` |
| Pre nextLeafIndex | 9 |
| Post nextLeafIndex | 10 |

Root changed ✅, `nextLeafIndex` advanced ✅. Destination commitment is now a live leaf in the Base Sepolia Merkle tree at `leafIndex = 9`.

---

## 9. Destination Withdrawal Evidence

| Parameter | Value |
|---|---|
| Network | Base Sepolia |
| Tx Hash | `0xee102071070c444b11efe4fac0be32ff238297ef19e96e356c932422cc5f3927` |
| Gas used | 324,834 |
| Destination leaf index | 9 |
| Destination nullifier hash | `0x1b2f72d6f3ad5ac33d92eb7b435df80cd8e7b84fd47243290c8de96ba50da6f7` |
| Amount withdrawn | 0.001 ETH |
| Relayer fee | 0 |
| Recipient | Deployer wallet (`0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`) |

Withdraw proof generated off-chain using:
- `merkle_root` = current Base tree root
- `merkle_path` computed from on-chain `filledSubtrees` and `zeros`
- `recipient` = deployer address (converted to BN254 scalar)
- `public_data_hash` = 0 (standard withdraw, not bridge-bound)

On-chain verification succeeded. Recipient balance increased by ~0.001 ETH (minus gas paid by sender).

---

## 10. Duplicate Bridge Replay Evidence

Second submission of `acceptBridgeMint` with identical message and signatures:

```
destInbox.acceptBridgeMint(message, thresholdSigs, 1)
→ reverts: execution reverted (MessageAlreadyConsumed)
```

`BridgeInbox.isMessageConsumed(messageHash)` returned `true` after first submission.

---

## 11. Duplicate Withdraw/Nullifier Replay Evidence

Second submission of `WhiteProtocol.withdraw` with identical proof and nullifier hash:

```
destWP.withdraw(destWithdrawProofBytes, destNullifierHash, ...)
→ reverts: execution reverted: Nullifier already spent
```

`WhiteProtocol.isSpent(destNullifierHash)` returned `true` after first withdrawal.

---

## 12. Direct BridgeOutbox Bypass Gated

Direct call to `BridgeOutbox.initBridgeOut` from deployer wallet:

```
sourceOutbox.initBridgeOut(message)
→ reverts: OnlyWhiteProtocol() (0x0c3b563c)
```

Only `WhiteProtocol` (set to `0xB637655...`) can call `initBridgeOut`. The deployer cannot bypass the ZK proof requirement.

---

## 13. Configuration Fix Evidence

### a. Base BridgeInbox whiteProtocol Correction

| Parameter | Value |
|---|---|
| Tx Hash | `0x90844cc64507dc8814c4a6d3a721630f18ccc8a69f71ba263226741cb5984eda` |
| Old value | `0x396e539bCDeAF48ab9526A13c6E688CBA69C059a` |
| New value | `0xb2e296a9D69e27F43d400aF2942Fb15F1b31750b` |

### b. Base Deployer Funding

| Parameter | Value |
|---|---|
| Source | Ethereum Sepolia L1StandardBridge (`0xfd0Bf71F60660E2f608ed56e1659C450eB113120`) |
| Bridge tx | `0x7b8cffc55d8cedcd0f4cfa2003b591bd1418b9d6b648843450c7ae86516402e9` |
| Amount | 0.005 ETH |
| Destination | Base Sepolia deployer (`0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`) |

---

## 14. RPC / State-Lag Mitigation

**Problem:** Base Sepolia RPC (`https://sepolia.base.org`) returned stale state immediately after transaction confirmation. Post-transaction queries for `getLastRoot()`, `nextLeafIndex()`, `getBalance()`, and `isSpent()` occasionally returned pre-transaction values.

**Root cause:** RPC node state propagation lag — the `tx.wait()` returned before the query node's view caught up.

**Fix applied:** Added 3-second `setTimeout` delays after Base transaction confirmations before querying state:

```typescript
const acceptReceipt = await acceptTx.wait();
await new Promise(r => setTimeout(r, 3000)); // Base RPC lag workaround
```

Same delay added after `withdraw` confirmation.

---

## 15. Manual Gas Fallback

**Problem:** `eth_estimateGas` on Base Sepolia occasionally returned generic `execution reverted` with no error data, causing ethers.js to throw `UNPREDICTABLE_GAS_LIMIT`.

**Root cause:** RPC-specific behavior where `eth_estimateGas` fails but `eth_call` succeeds for the same data. Also observed when account balance was temporarily insufficient.

**Fix applied:** Wrap `acceptBridgeMint` in try/catch; if gas estimation fails, retry with explicit `gasLimit: 1500000`:

```typescript
let acceptTx;
try {
  acceptTx = await destInbox.acceptBridgeMint(message, thresholdSigs, 1);
} catch (e: any) {
  if (e.code === 'UNPREDICTABLE_GAS_LIMIT') {
    acceptTx = await destInbox.acceptBridgeMint(message, thresholdSigs, 1, { gasLimit: 1500000 });
  } else {
    throw e;
  }
}
```

---

## 16. Env Loading Fix

**Problem:** `.env` and `.bridge-signers.env` files use `KEY=value` format without `export` keywords. Standard `source .env && npx tsx ...` does not export variables to the child Node.js process.

**Fix:** Use `set -a` (auto-export) before sourcing:

```bash
set -a && source .env && source .bridge-signers.env && set +a && npx tsx test/e2e-bridge-ethereum-to-base.ts
```

---

## 17. Tests / Commands Run

### EVM Unit Tests
```bash
cd chains/evm && forge test -vvv
```
**Result:** 158 tests passed, 0 failed, 0 skipped

### Relayer Tests
```bash
cd relayer && npm run test
```
**Result:** 210 tests passed, 0 failed

### Relayer Typecheck
```bash
cd relayer && npm run typecheck
```
**Result:** Clean (no errors)

### Relayer Build
```bash
cd relayer && npm run build
```
**Result:** Clean (`dist/` generated)

### Live E2E
```bash
cd chains/evm
set -a && source .env && source .bridge-signers.env && set +a
npm run test:e2e:bridge:ethereum-to-base:full
```
**Result:** ✅ All 17 steps passed (retry 12)

---

## 18. E2E Rerun Decision

**Live E2E rerun:** Skipped

**Reason:** A clean successful run was achieved on retry 12. The Base Sepolia deployer balance after the successful run is ~0.00275 ETH. While sufficient for one more run, it is borderline (acceptBridgeMint alone consumes ~0.0015 ETH in gas). To avoid a mid-test failure due to insufficient funds, the previous successful run is documented as canonical. Funds can be replenished from the Ethereum Sepolia side (deployer has ~0.22 ETH there) if future runs are needed.

---

## 19. Security Limitations

- **Testnet only:** All contracts are on Ethereum Sepolia and Base Sepolia. Not audited for mainnet.
- **Test signer set:** 2-of-3 secp256k1 threshold using testnet-only keys stored in `.bridge-signers.env`.
- **Manual relayer:** Threshold signatures are generated inside the E2E script. No automated daemonized bridge relayer is running in production.
- **Operational liquidity:** Base Sepolia `WhiteProtocol` pool was manually funded with ETH before the test. Real deployments need automated rebalancing or deep vault liquidity.
- **No watcher/challenge:** Reorg detection, freeze UI, and challenge windows are not yet implemented.
- **public_data_hash dummy constraint:** The withdraw circuit's `public_data_hash` only has a dummy square constraint. Full semantic binding is enforced on-chain, not in-circuit.

---

## 20. Next Recommended PR

**PR-010L — Solana ↔ EVM Bridge E2E**

**Why:** Both EVM↔EVM directions (Base→Ethereum and Ethereum→Base) are now proven. The next frontier is cross-paradigm: Solana Devnet ↔ Base Sepolia or Solana Devnet ↔ Ethereum Sepolia.

**Scope:**
1. Deploy Solana bridge config accounts to Devnet
2. Configure Solana ↔ Base and Solana ↔ Ethereum routes
3. Handle asset ID version differences (Solana v1, EVM v2)
4. Test commitment derivation across domain boundaries
5. Measure Solana CU for threshold verification

**Alternative:** PR-010M — BNB Chain / Polygon Amoy route expansion (all-EVM, lower risk).

---

## Files Changed

| File | Change |
|---|---|
| `chains/evm/test/e2e-bridge-ethereum-to-base.ts` | **Created** — canonical reverse-direction E2E script |
| `chains/evm/deployments/ethereum-sepolia.json` | Updated — new WP `0xB63765...`, BridgeOutbox `0xbcE12C...`, `verifiedE2E: true` |
| `chains/evm/deployments/base-sepolia.json` | Updated — `verifiedE2E: true`, notes updated |
| `chains/evm/script/UpgradeEthereumWP.s.sol` | **Created** — Foundry script for Ethereum WP redeploy |
| `chains/evm/deployments/ethereum-sepolia-pr010g-backup.json` | **Created** — backup of PR-010G artifact |
| `docs/fixes/PR-010K-ethereum-to-base-full-bridge-e2e.md` | **Created** — this document |
| `docs/bridge/private-bridge-implementation-plan.md` | Updated — PR-010K marked complete, next PR updated |