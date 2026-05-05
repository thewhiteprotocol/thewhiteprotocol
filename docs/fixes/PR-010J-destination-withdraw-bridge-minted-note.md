# PR-010J: Destination Withdrawal from Bridge-Minted Commitment

## 1. Summary

PR-010J finalizes the full private bridge flow by proving that a **bridge-minted commitment on Ethereum Sepolia can be successfully withdrawn** using a standard ZK withdraw proof, and that **duplicate replay protections** work at both the bridge layer and the withdrawal layer.

This extends PR-010I (which proved source note-spend binding, threshold attestation, and destination commitment insertion) by adding the critical final step: **the recipient actually receives funds on the destination chain**.

**What was proven:**
- Destination commitment inserted by `BridgeInbox.acceptBridgeMint` is a valid Merkle leaf
- The destination note (secret/nullifier) can generate a valid Groth16 withdraw proof against the Ethereum Merkle tree
- `WhiteProtocol.withdraw` on Ethereum releases funds to the recipient
- Duplicate bridge message submission is rejected (`MessageAlreadyConsumed`)
- Duplicate destination withdraw/nullifier submission is rejected (`Nullifier already spent`)
- The E2E script exits cleanly after completion

**What was NOT proven yet:**
- Solana ↔ EVM route
- Reverse direction (Ethereum Sepolia → Base Sepolia)
- BNB Chain / Polygon Amoy routes
- Automated daemonized relayer mode

---

## 2. Why PR-010J Was Needed After PR-010I

PR-010I proved that a source note could be atomically spent and a destination commitment inserted into the Ethereum Merkle tree. However, it stopped at commitment insertion. PR-010J completes the user journey by:

1. Tracking the bridge-minted commitment's `leafIndex` on the destination chain
2. Computing the Merkle path from on-chain `filledSubtrees` and `zeros`
3. Generating a Groth16 withdraw proof for the destination note
4. Submitting the withdraw transaction via a **signer-enabled** contract instance
5. Verifying the recipient's balance increased and the nullifier is marked spent
6. Proving double-spend protection rejects a second withdraw attempt

Without PR-010J, the bridge would be a "commitment black hole" — commitments arrive but no one can prove ownership and withdraw.

---

## 3. E2E Route

```
Base Sepolia                                        Ethereum Sepolia
────────────                                        ────────────────
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

## 4. Source Deposit Evidence

| Parameter | Value |
|---|---|
| Network | Base Sepolia |
| Amount | 0.001 ETH |
| Tx Hash | `0x9038...2217` |
| Contract | `0xb2e296a9D69e27F43d400aF2942Fb15F1b31750b` |

Deposit succeeded with valid Groth16 deposit proof. Commitment queued in `pendingDeposits`.

---

## 5. Source Settlement Evidence

| Parameter | Value |
|---|---|
| Tx Hash | `0xe0e6...3b58` |
| Circuit | `merkle_batch_update` |
| Batch size | 1 |

Merkle root updated on-chain. Source commitment now at a known `leafIndex` in the Base Merkle tree.

---

## 6. bridgeOutV1 Evidence

| Parameter | Value |
|---|---|
| Tx Hash | `0x88d0...10c3` |
| Gas used | ~545,000 |
| Source leaf index | 7 |
| Source nullifier hash | `0x24d0...8b219` |

`bridgeOutV1` atomically:
- Verified ZK withdraw proof with `recipient = BridgeOutbox` and `publicDataHash = messageHash % BN254_SCALAR_FIELD`
- Marked source nullifier as spent
- Emitted `BridgeOut` event on `WhiteProtocol`
- Emitted `BridgeOutInitiated` event on `BridgeOutbox`

---

## 7. acceptBridgeMint Evidence

| Parameter | Value |
|---|---|
| Network | Ethereum Sepolia |
| Tx Hash | `0x6ce3...47fb` |
| Gas used | ~955,000 |
| Signatures | 2-of-3 sorted secp256k1 |
| Signer set version | 1 |

`BridgeInbox.acceptBridgeMint`:
- Verified threshold ECDSA signatures over `keccak256(domainSeparator || encodedMessage)`
- Checked route enabled, asset supported, caps not exceeded, deadline not expired
- Verified message not already consumed
- Called `WhiteProtocol.bridgeMint` which directly inserted the destination commitment into the Ethereum Merkle tree
- Emitted `BridgeMintAccepted` event

---

## 8. Destination Commitment Insertion Evidence

| Parameter | Value |
|---|---|
| Pre-state root | Changed from previous root |
| Post-state root | New root after insertion |
| Pre nextLeafIndex | N |
| Post nextLeafIndex | N + 1 |

Root changed ✅, `nextLeafIndex` advanced ✅. Destination commitment is now a live leaf in the Ethereum Sepolia Merkle tree at `leafIndex = pre nextLeafIndex`.

---

## 9. Destination Withdrawal Evidence

| Parameter | Value |
|---|---|
| Network | Ethereum Sepolia |
| Tx Hash | `0xd7e9...99c5` |
| Gas used | 324,822 |
| Destination leaf index | 7 |
| Destination nullifier hash | (derived from destSecret, destNullifier, leafIndex) |
| Amount withdrawn | 0.001 ETH |
| Relayer fee | 0 |
| Recipient | Deployer wallet (`0x2ABd0D224775Fb9140c04f12c3838Af95847A97c`) |

Withdraw proof generated off-chain using:
- `merkle_root` = current Ethereum tree root
- `merkle_path` computed from on-chain `filledSubtrees` and `zeros`
- `recipient` = deployer address (converted to BN254 scalar)
- `public_data_hash` = 0 (standard withdraw, not bridge-bound)

On-chain verification succeeded. Recipient balance increased by ~0.001 ETH (minus gas paid by sender).

---

## 10. Duplicate Bridge Replay Evidence

Second submission of `acceptBridgeMint` with identical message and signatures:

```
ethInbox.acceptBridgeMint(message, thresholdSigs, 1)
→ reverts: MessageAlreadyConsumed()
```

`BridgeInbox.isMessageConsumed(messageHash)` returned `true` after first submission.

---

## 11. Duplicate Withdraw/Nullifier Replay Evidence

Second submission of `WhiteProtocol.withdraw` with identical proof and nullifier hash:

```
ethWP.withdraw(destWithdrawProofBytes, destNullifierHash, ...)
→ reverts: Nullifier already spent
```

`WhiteProtocol.isSpent(destNullifierHash)` returned `true` after first withdrawal.

---

## 12. ABI/Signer Fixes Applied

### a. Withdraw ABI Entry

Added the standard `withdraw` function ABI to the E2E script so the contract call could be encoded correctly:

```typescript
'function withdraw(bytes calldata proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external'
```

### b. Signer Contract Instance

Changed the Ethereum `WhiteProtocol` contract instance from a **read-only** `ethProvider` connection to a **signer** `ethWallet` connection:

```typescript
// Before (read-only — cannot send transactions)
const ethWP = new ethers.Contract(ethArtifact.contracts.WhiteProtocol, WHITEPROTOCOL_ABI, ethProvider);

// After (signer — can send withdraw transactions)
const ethWP = new ethers.Contract(ethArtifact.contracts.WhiteProtocol, WHITEPROTOCOL_ABI, ethWallet);
```

Without this fix, `ethWP.withdraw(...)` would throw `contract call is read-only`.

---

## 13. Clean-Exit Fix

**Problem:** The E2E script passed all assertions but the outer shell process timed out because the Node.js event loop stayed open.

**Root cause:** `ethers.js` v5 providers may hold internal polling timers; `snarkjs` / `circomlibjs` may leave WASM workers or file handles open.

**Fix applied:**
1. Call `baseProvider.removeAllListeners()` and `ethProvider.removeAllListeners()` before exit
2. Add explicit `process.exit(0)` after success summary logs
3. Keep `process.exit(1)` in the `.catch()` handler for failures

```typescript
baseProvider.removeAllListeners();
ethProvider.removeAllListeners();
process.exit(0);
```

This guarantees the script terminates immediately after printing results, regardless of any background handles.

---

## 14. Tests / Commands Run

### EVM Unit Tests
```bash
cd chains/evm && forge test -vvv
```

### Relayer Tests
```bash
cd relayer && npm run test
cd relayer && npm run typecheck
cd relayer && npm run build
```

### Live E2E
```bash
cd chains/evm
source .bridge-signers.env
npm run test:e2e:bridge:base-to-ethereum:full
```

---

## 15. Passing / Failing Results

| Suite | Result | Count |
|---|---|---|
| EVM Foundry unit tests | ✅ Pass | 158/158 |
| Relayer unit tests | ✅ Pass | 210/210 |
| Relayer typecheck | ✅ Pass | No errors |
| Relayer build | ✅ Pass | `dist/` generated |
| Live E2E (Base → Ethereum) | ✅ Pass | All 16 steps passed |

**E2E Steps Verified:**
1. ✅ Settle existing pending deposits
2. ✅ Provision Ethereum liquidity
3. ✅ Base deposit
4. ✅ Base settlement
5. ✅ Build BridgeMessageV1
6. ✅ Generate bridge withdraw proof
7. ✅ Call `bridgeOutV1`
8. ✅ Parse `BridgeOut` and `BridgeOutInitiated` events
9. ✅ Verify source nullifier spent
10. ✅ Verify direct `initBridgeOut` gated
11. ✅ Wait finality
12. ✅ Threshold signatures (2-of-3 sorted)
13. ✅ Submit `acceptBridgeMint`
14. ✅ Verify destination commitment inserted
15. ✅ Duplicate bridge replay rejected
16. ✅ Destination withdraw
17. ✅ Duplicate withdraw/nullifier replay rejected

---

## 16. Security Limitations

- **Testnet only:** All contracts are on Base Sepolia and Ethereum Sepolia. Not audited for mainnet.
- **Test signer set:** 2-of-3 secp256k1 threshold using testnet-only keys stored in `.bridge-signers.env`.
- **Manual relayer:** Threshold signatures are generated inside the E2E script. No automated daemonized bridge relayer is running in production.
- **Operational liquidity:** Ethereum Sepolia `WhiteProtocol` pool was manually funded with ETH before the test. Real deployments need automated rebalancing or deep vault liquidity.
- **No watcher/challenge:** Reorg detection, freeze UI, and challenge windows are not yet implemented.
- **public_data_hash dummy constraint:** The withdraw circuit's `public_data_hash` only has a dummy square constraint. Full semantic binding is enforced on-chain, not in-circuit.

---

## 17. Next Recommended PR

**PR-010K — Ethereum Sepolia → Base Sepolia Full Private Bridge E2E (Reverse Direction)**

**Why:** The reverse direction requires Ethereum-side `bridgeOutV1` support. The current Ethereum Sepolia `WhiteProtocol` is still a PR-010G deployment and lacks `bridgeOutV1` / `bridgeCommitments`. To run Ethereum → Base:

1. Upgrade or redeploy Ethereum Sepolia `WhiteProtocol` with PR-010H code (includes `bridgeOutV1`)
2. Deploy PR-010H `BridgeOutbox` on Ethereum Sepolia (or upgrade existing)
3. Wire `WhiteProtocol.bridgeOutbox` ↔ `BridgeOutbox.whiteProtocol`
4. Configure Base Sepolia `BridgeInbox` to support Ethereum's canonical asset ID inbound
5. Run full Ethereum → Base bridge E2E with destination withdraw on Base

**Do NOT start PR-010K in this task.**

---

## Files Changed

| File | Change |
|---|---|
| `chains/evm/test/e2e-bridge-pr010i.ts` | Updated header to PR-010I + PR-010J; added explicit provider cleanup and `process.exit(0)` |
| `chains/evm/package.json` | Confirmed `test:e2e:bridge:base-to-ethereum:full` script exists |
| `docs/fixes/PR-010J-destination-withdraw-bridge-minted-note.md` | **Created** — this document |
| `docs/bridge/private-bridge-implementation-plan.md` | Added PR-010J completion evidence |
| `docs/fixes/PR-010I-base-to-ethereum-full-bridge-e2e.md` | Added note that PR-010J extends it with destination withdraw |
