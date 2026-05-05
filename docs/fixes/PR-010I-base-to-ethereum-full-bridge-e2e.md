# PR-010I: Base Sepolia → Ethereum Sepolia Full Bridge E2E (with Source Note-Spend Binding)

## 1. Summary

Live end-to-end test of the complete PR-010H private bridge flow: deposit on Base Sepolia, settle into Merkle tree, generate a ZK withdraw proof with `recipient=BridgeOutbox` and `publicDataHash=messageHash`, atomically spend the note via `bridgeOutV1`, wait for finality, submit threshold-signed attestation to Ethereum Sepolia `BridgeInbox.acceptBridgeMint`, and verify destination commitment insertion.

**What was proven:**
- Full source note-spend binding via ZK withdraw proof in `bridgeOutV1`
- `publicDataHash` field-safety (BN254 scalar field prime enforcement)
- `destinationCommitment` field-safety for Merkle tree insertion on destination chain
- Atomic bridge out: nullifier spent + BridgeOutInitiated event in single tx
- BridgeInbox threshold signature verification and message consumption
- `WhiteProtocol.bridgeMint` commitment insertion into destination Merkle tree
- Duplicate submit replay protection (`MessageAlreadyConsumed`)
- Direct `BridgeOutbox.initBridgeOut` access gating (owner/WhiteProtocol only)

**What was NOT proven yet:**
- Solana ↔ EVM route
- Full daemonized relayer mode (E2E used script calling modules directly)
- Explorer contract verification for PR-010H contracts
- Reverse direction (Ethereum Sepolia → Base Sepolia)

> **Extended by PR-010J:** Destination withdrawal from bridge-minted commitment, duplicate destination withdraw/nullifier replay rejection, and E2E script clean-exit fix. See `docs/fixes/PR-010J-destination-withdraw-bridge-minted-note.md`.

---

## 2. Contracts Deployed

### Base Sepolia (PR-010H redeploy)

| Parameter | Value |
|---|---|
| Network | base-sepolia |
| Chain ID | 84532 |
| Domain ID | 33554434 (0x02000002) |
| Deployer | `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c` |
| WhiteProtocol | `0xb2e296a9D69e27F43d400aF2942Fb15F1b31750b` |
| BridgeOutbox | `0x7eaFB77E2F05Bf0EbCb8F1A51B187BbcdBCb985D` |
| AssetRegistry | `0x5510604D8510Bc38D21ca98bB2493eD2DA39Ca5d` |
| PoseidonT3 | `0xeb7c3A1f37CBB1681E515d0B9682d12E66D312Ce` |
| Signer set version | 1 |
| Threshold | 2-of-3 |
| Canonical asset ID | `0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70` |

**Routes enabled:** Ethereum Sepolia (33554435), Polygon Amoy (33554436), BSC Testnet (33554438)

### Ethereum Sepolia (PR-010G, unchanged contracts)

| Parameter | Value |
|---|---|
| Network | ethereum-sepolia |
| Chain ID | 11155111 |
| Domain ID | 33554435 (0x02000003) |
| Deployer | `0x2ABd0D224775Fb9140c04f12c3838Af95847A97c` |
| WhiteProtocol | `0x5813d68a130C451420C670F5aA4a7D68F438101A` |
| BridgeInbox | `0x236BaE88bd55779CaFC88c90afC9E336131b3463` |
| BridgeOutbox | `0x8831AB44113a5De63f1577E157F3E7faaBeeC314` |
| AssetRegistry | `0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B` |
| Signer set version | 1 |
| Threshold | 2-of-3 |
| Local canonical asset ID | `0x00edb10e06c7047f8f59c54c5cfe2ecdf404186ba5af05b8eb07827446d4a013` |

**Post-deploy configuration for inbound Base asset:**
- `supportAsset(0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70)` — tx `0x353f3c4cfc68ba41578f35973778e058919afc1c5c86e803eeaa6aba8ea6817a`
- `setLocalAsset(baseCanonicalAssetId, 0x0000...0000)` — tx `0xc77d63ed2d6969f419664723473a2a8e689a303c02e808ac79e7df71f2010164`

---

## 3. Signer Set Configuration

Same 2-of-3 testnet signer set as PR-010G.

| # | Address |
|---|---|
| 1 | `0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820` |
| 2 | `0xbd7d34e42352BCe888394263A84CF21c85608beC` |
| 3 | `0xEa4A68F39630C5145f1840D754B470a9fa5F2c19` |

**Threshold:** 2-of-3  
**Sorting:** Addresses sorted ascending (contract requirement)  
**Private keys:** Stored in `chains/evm/.bridge-signers.env` (gitignored)

---

## 4. E2E Transaction Log

### Base Sepolia

| Step | Tx Hash | Gas Used | Block |
|---|---|---|---|
| Deposit | `0x2fa42fe61ad00b0256f52a8823a4e893e34aa1bea283804762792f3f3443fe8d` | ~250,000 | 41074923 |
| Settlement | `0x2f231e1f727c5a05a26ee960a3db081331456a036e6799e4b6301c91118608d4` | ~280,000 | 41074927 |
| `bridgeOutV1` | `0x371b46def810cd67dea044776eeb930d000e4155be7451ceb278638d8b679f5e` | 545,291 | 41074930 |

### Ethereum Sepolia

| Step | Tx Hash | Gas Used | Block |
|---|---|---|---|
| `supportAsset` (inbound Base asset) | `0x353f3c4cfc68ba41578f35973778e058919afc1c5c86e803eeaa6aba8ea6817a` | ~45,000 | 10789874 |
| `setLocalAsset` (inbound Base asset) | `0xc77d63ed2d6969f419664723473a2a8e689a303c02e808ac79e7df71f2010164` | ~45,000 | 10789874 |
| `acceptBridgeMint` | `0xd280bb7a2a7751e6d02187310604933f111c358ff90646bb9a7c82a171fee6aa` | 955,170 | 10789903 |

---

## 5. BridgeMessageV1 Fields (Final Successful Run)

```
protocolVersion: 1
messageType: 1 (BridgeOut)
sourceDomain: 33554434 (Base Sepolia)
destinationDomain: 33554435 (Ethereum Sepolia)
sourceChainId: 84532
destinationChainId: 11155111
canonicalAssetId: 0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70
sourceLocalAssetId: 0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70
destinationLocalAssetId: 0x00edb10e06c7047f8f59c54c5cfe2ecdf404186ba5af05b8eb07827446d4a013
amount: 0.001 ETH (1000000000000000)
sourceNullifierHash: 0x23b72786508de4c2e0b666aa56dd49649cf9b903b7ed538eb7ef52ef7e65465b
destinationCommitment: 0x124db3f6c9128b60d3122ca9818eac30a6ffea74200aa911252200b284471891
sourceRoot: 0x1381215605818130957129737907225102899978...
sourceLeafIndex: 2
sourceTxHash: 0x0000...0000
sourceBlockNumber: 0
sourceFinalityBlock: 0
nonce: 3
deadline: 1777925242
relayerFee: 0.0001 ETH
```

**Message hash:** `0xfedca5611ca73d1ec304f8740d45ae223b1e60b17719f3d156ca98eae32cb2f2`

---

## 6. Evidence

### Commitment Insertion on Ethereum

```
Pre-state root:  0x28d96c20f14c2a8fd23fa3aef32a405e4e3ec66ab20c0cfb14054cad8eb1de1f
Post-state root: 0x2e1967657552c40cac60e4df0e422fdc1d58ef9c57f2ef8cf465bcd9fadb9f40
Pre nextLeafIndex:  5
Post nextLeafIndex: 6
```

Root changed ✅, nextLeafIndex advanced ✅.

### Duplicate Submit Rejection

Second submission of same message hash reverts with `MessageAlreadyConsumed`:

```
ethInbox.acceptBridgeMint(message, thresholdSigs, 1)
→ reverts: cannot estimate gas; transaction may fail
→ on-chain: MessageAlreadyConsumed()
```

---

## 7. Fixes Applied During PR-010I

### a. Ethereum BridgeInbox Inbound Asset Support

**Problem:** `acceptBridgeMint` reverted with `AssetNotSupported()` because the Ethereum BridgeInbox only recognized its own local canonical asset ID (`0x00edb10e...`), not Base Sepolia's (`0x00fb58d8...`).

**Root cause:** Each chain computes its own v2 canonical asset ID from its domain ID. For cross-chain bridging, the destination inbox must be explicitly configured to support inbound canonical asset IDs from peer chains.

**Fix (on-chain):**
```solidity
// Ethereum Sepolia BridgeInbox 0x236BaE...b3463
supportAsset(0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70);
setLocalAsset(
  0x00fb58d8ea79c42a023685014b8281e7508bd5ca5f570f336f5852a291d54a70,
  0x0000000000000000000000000000000000000000 // native ETH
);
```

**Deployment artifact update:** `chains/evm/deployments/ethereum-sepolia.json` now includes `bridgeV1.inboundAssets` array documenting supported inbound canonical asset IDs.

### b. SNARK Field-Safe `destinationCommitment`

**Problem:** `acceptBridgeMint` → `whiteProtocol.bridgeMint` → `insert(destinationCommitment)` reverted with `Leaf should be inside SNARK field`.

**Root cause:** `destinationCommitment` was generated as `randomBigInt(32)`, producing a 256-bit value that could exceed the BN254 scalar field prime (`~2^254`). The `MerkleTreeWithHistory.insert()` function requires `leaf < SNARK_SCALAR_FIELD`.

**Fix (E2E script):**
```typescript
const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const destinationCommitment = randomBigInt(32) % SNARK_SCALAR_FIELD;
```

This ensures the commitment is a valid field element and can be inserted into the destination Merkle tree.

### c. SNARK Field-Safe `publicDataHash` (already applied in PR-010H)

The `publicDataHash` passed to the withdraw circuit was already masked to fit the BN254 scalar field:
```typescript
const publicDataHash = BigInt(messageHash) % BN254_SCALAR_FIELD;
```

---

## 8. Files Changed

| File | Change |
|---|---|
| `chains/evm/test/e2e-bridge-pr010i.ts` | **Canonical E2E script** — added field-safe `destinationCommitment` |
| `chains/evm/test/e2e-bridge-base-to-ethereum.ts` | **Removed** — superseded by PR-010I |
| `chains/evm/test/retry-accept-bridge-mint.ts` | **Removed** — debug-only, not needed after fix |
| `chains/evm/package.json` | Added `test:e2e:bridge:base-to-ethereum:full` script |
| `chains/evm/deployments/ethereum-sepolia.json` | Added `bridgeV1.inboundAssets` metadata |
| `chains/evm/deployments/base-sepolia.json` | Added `bridgeV1.outboundAssets` metadata |
| `docs/fixes/PR-010I-base-to-ethereum-full-bridge-e2e.md` | **Created** — this document |

---

## 9. Running the E2E

```bash
cd chains/evm
source .bridge-signers.env
npm run test:e2e:bridge:base-to-ethereum:full
```

Required env vars:
- `DEPLOYER_PRIVATE_KEY`
- `BRIDGE_SIGNER_1_PRIVATE_KEY`
- `BRIDGE_SIGNER_2_PRIVATE_KEY`
- `BRIDGE_SIGNER_3_PRIVATE_KEY`

---

## 10. Remaining Limitations

- Ethereum Sepolia contracts are still PR-010G (old `WhiteProtocol` without `bridgeOutV1` or `bridgeCommitments`)
- Reverse bridge direction (Ethereum → Base) requires Ethereum `WhiteProtocol` to support `bridgeOutV1` — needs contract upgrade or redeploy
- No automated relayer yet; threshold signatures are generated manually in the E2E script
- BridgeOutbox direct `initBridgeOut` is gated but the production path (`initBridgeOutFromProtocol`) requires `whiteProtocol` caller — verified working

---

## 11. Next Recommended PR

**PR-010J: Ethereum Sepolia `bridgeOutV1` support (reverse direction)**

- Upgrade or redeploy Ethereum Sepolia `WhiteProtocol` with PR-010H code (requires PoseidonT3 link)
- Deploy PR-010H `BridgeOutbox` on Ethereum Sepolia (or upgrade existing)
- Wire `WhiteProtocol.bridgeOutbox` and `BridgeOutbox.whiteProtocol`
- Configure Base Sepolia `BridgeInbox` to support Ethereum's canonical asset ID inbound
- Run full Ethereum → Base bridge E2E
