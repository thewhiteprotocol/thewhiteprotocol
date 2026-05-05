# Private Bridge v1 — Implementation Plan

**Version:** 1.1  
**Date:** 2026-05-04  
**Status:** EVM↔EVM Testnet Live / Solana Pending

---

## 1. Overview

This plan defines the concrete implementation steps for The White Protocol Private Bridge v1.

**Current state:**
- EVM BridgeInbox/BridgeOutbox deployed on Base Sepolia, Ethereum Sepolia, Polygon Amoy, BSC Testnet
- Solana bridge mint instruction (`accept_bridge_v1_mint`) implemented in main program
- Relayer bridge service implemented with state machine, signer service, EVM adapter, status API
- First EVM↔EVM E2E (Base Sepolia → Ethereum Sepolia) completed successfully
- Reverse EVM↔EVM E2E (Ethereum Sepolia → Base Sepolia) completed successfully
- Forward EVM↔EVM E2E (Base Sepolia → BSC Testnet) completed successfully
- Forward EVM↔EVM E2E (Base Sepolia → Polygon Amoy) completed successfully
- No bridge-specific circuits; `public_data_hash` has dummy constraint

---

## 2. Existing Code Audit Matrix

| Component | Current Status | Real/Stubbed | Reusable for v1? | Risk | Action Required |
|-----------|---------------|--------------|------------------|------|-----------------|
| `BridgeInbox.sol` / `BridgeOutbox.sol` (EVM) | Deployed & tested | Real | Yes — threshold, pause, caps | Low | Monitor mainnet readiness |
| `BridgeAttestationLib.sol` | Deployed & tested | Real | Yes — secp256k1 raw hash | Low | None |
| `WhiteProtocol.sol` hooks | Deployed & tested | Real | Yes — `bridgeMint`/`bridgeWithdraw` | Low | None |
| Solana `accept_bridge_v1_mint` | Implemented & tested | Real | Yes — threshold + pending buffer | Low | Needs devnet deployment for E2E |
| Relayer bridge service | Implemented & tested | Real | Yes — state machine, signer, adapters | Low | Needs daemonized polling mode |
| `packages/core` bridge message | Implemented & tested | Real | Yes — encoding, hashing, validation | Low | None |
| Bridge E2E script | Implemented | Real | Yes — Base↔Ethereum bidirectional proven | Low | Extend to Solana and other EVM routes |

---

## 3. Implementation PR Sequence

### PR-010B: Bridge Message Format Library ✅ COMPLETE

**Deliverable:** All three languages compute identical `messageHash` for the same inputs.

---

### PR-010C: EVM BridgeInbox/Outbox v1 ✅ COMPLETE

**Deliverable:** EVM contracts compile, 149 tests pass, threshold signature verification works.

---

### PR-010D: Solana Bridge Program v1 ✅ COMPLETE (in main program)

**Deliverable:** `accept_bridge_v1_mint` instruction compiles, 115 Solana tests pass, SBF build passes.

---

### PR-010E: Relayer Bridge Service ✅ COMPLETE

**Deliverable:** Relayer bridge module with state store, signer service, EVM/Solana adapters, status API. 210/210 relayer tests pass.

---

### PR-010F: Bridge Relayer Attestation Service ✅ COMPLETE

**Scope:**
- Bridge relayer state machine (JSON file-based persistence)
- Bridge signer service (secp256k1 raw hash signing, sorted signatures)
- EVM bridge adapter (viem-based event watching + submit)
- Solana bridge adapter skeleton (instruction builder + PDA derivations)
- Bridge status API endpoints
- 35 new bridge tests

**Deliverable:** Bridge relayer foundation complete, all tests pass.

---

### PR-010G: Base ↔ Ethereum E2E Bridge ✅ COMPLETE

**Scope:**
- Deploy BridgeInbox/Outbox to Base Sepolia and Ethereum Sepolia
- Configure 2-of-3 test signer set
- Configure routes, assets, caps
- Run message-level E2E: Base BridgeOut → relayer signs → Ethereum BridgeIn → WhiteProtocol commitment insertion
- Verify duplicate submit rejection

**Deliverable:** First live EVM↔EVM bridge message proven end-to-end.

**Results:**
- Base Sepolia BridgeOutbox: `0xA195F05dDFe97514c7a7ede113204f8752828383`
- Base Sepolia BridgeInbox: `0x4D4aDB460C5C882bEcbe95d0562769ECa812D1FC`
- Ethereum Sepolia BridgeOutbox: `0x8831AB44113a5De63f1577E157F3E7faaBeeC314`
- Ethereum Sepolia BridgeInbox: `0x236BaE88bd55779CaFC88c90afC9E336131b3463`
- Gas for `acceptBridgeMint` (2-of-3): ~954,229
- E2E tx: BridgeOut `0xb78be5db...`, BridgeIn `0x0513bc95...`

---

### PR-010H: Source Note-Spend / Nullifier Binding ✅ COMPLETE

**Scope:**
- Add `WhiteProtocol.bridgeOutV1` that requires a valid ZK withdraw proof
- Bind `publicDataHash` to the bridge message hash (mod BN254 scalar field)
- Close direct `BridgeOutbox.initBridgeOut` production bypass
- Verify nullifier is atomically spent during bridge out

**Deliverable:** Source note cannot be bridged without a valid ZK proof; message hash is cryptographically bound to the proof.

---

### PR-010I: Base Sepolia → Ethereum Sepolia Full Bridge E2E ✅ COMPLETE

**Scope:**
- Deposit on Base, settle, generate bridge withdraw proof
- Call `bridgeOutV1`, wait finality, produce 2-of-3 threshold signatures
- Submit `acceptBridgeMint` on Ethereum
- Verify destination commitment insertion
- Prove duplicate bridge replay rejection

**Deliverable:** Full source-to-destination commitment flow proven live.

See `docs/fixes/PR-010I-base-to-ethereum-full-bridge-e2e.md` for full transaction log.

---

### PR-010J: Destination Withdrawal from Bridge-Minted Commitment ✅ COMPLETE

**Scope:**
- Generate destination withdraw proof for the bridge-minted commitment on Ethereum
- Call `WhiteProtocol.withdraw` using a signer-enabled contract instance
- Verify recipient receives funds and nullifier is marked spent
- Prove duplicate destination withdraw/nullifier replay rejection
- Fix E2E script clean exit (explicit provider cleanup + `process.exit(0)`)

**Deliverable:** The full private bridge user journey is complete: deposit → bridge → withdraw.

**Evidence:**
- Destination withdraw tx: `0xd7e9...99c5`
- Gas used: 324,822
- Duplicate bridge replay: rejected (`MessageAlreadyConsumed`)
- Duplicate withdraw replay: rejected (`Nullifier already spent`)

See `docs/fixes/PR-010J-destination-withdraw-bridge-minted-note.md` for full report.

---

### PR-010K: Ethereum Sepolia → Base Sepolia Full Bridge E2E (Reverse Direction) ✅ COMPLETE

**Scope:**
- Redeploy Ethereum Sepolia `WhiteProtocol` with `bridgeOutV1` support
- Wire new Ethereum WP to BridgeOutbox; wire BridgeInbox to correct Base WP
- Configure Base BridgeInbox for inbound Ethereum canonical asset ID
- Fund Base Sepolia deployer via L1→L2 bridge
- Run full E2E: deposit → settle → bridgeOutV1 → threshold sign → acceptBridgeMint → destination withdraw
- Prove duplicate bridge replay and duplicate destination withdraw rejection
- Fix RPC state-lag issues and gas estimation failures

**Deliverable:** Reverse-direction private bridge proven end-to-end. Both EVM↔EVM directions now work.

**Evidence:**
- Ethereum deposit tx: `0xfc4d0449...`
- Ethereum bridgeOutV1 tx: `0x14d1fda8...`
- Base acceptBridgeMint tx: `0x3d964bbe...`
- Base destination withdraw tx: `0xee102071...`

See `docs/fixes/PR-010K-ethereum-to-base-full-bridge-e2e.md` for full report.

---

### PR-010L: BNB Chain + Polygon EVM Routes ✅ COMPLETE (Forward Routes)

**Scope:**
- Deploy BridgeInbox/BridgeOutbox to BNB Testnet and Polygon Amoy
- Add routes: Base → BNB, Base → Polygon (forward only; reverse requires WP redeploy with bridgeOutV1)
- Test all combinations
- Tune gas and finality per chain

**Deliverable:** Forward routes from Base Sepolia to BNB Testnet and Polygon Amoy proven end-to-end.

**Evidence:**

Route A: Base Sepolia → BSC Testnet
- Base deposit tx: `0x212d47d0...`
- Base bridgeOutV1 tx: `0x5349e301...`
- BSC acceptBridgeMint tx: `0x529a43f0...`
- BSC destination withdraw tx: `0x7aa87067...`
- Gas: bridgeOutV1 545,255 | acceptBridgeMint 992,356 | withdraw 324,798

Route B: Base Sepolia → Polygon Amoy
- Base deposit tx: `0x74f74d1c...`
- Base bridgeOutV1 tx: `0x5f0165d6...`
- Polygon acceptBridgeMint tx: `0x495664bf...`
- Polygon destination withdraw tx: `0x0da0eed2...`
- Gas: bridgeOutV1 545,315 | acceptBridgeMint 992,404 | withdraw 324,798

**Fixes Applied:**
- Cross-chain canonical asset mapping: destination BridgeInboxes need `supportAsset` + `setLocalAsset` for source domain asset IDs
- Polygon Amoy gas override: legacy transactions at 35 gwei required (publicnode enforces min 25 gwei tip)
- Base deployer funding via L1StandardBridge `0xfd0Bf71F60660E2f608ed56e1659C450eB113120`
- BSC RPC fallback: `data-seed-prebsc-1-s1.bnbchain.org:8545` (publicnode lacks archive state)

**Notes:**
- BNB and Polygon WhiteProtocol deployments lack `bridgeOutV1`; reverse routes require WP redeploy
- All replay protections verified: duplicate bridge → `MessageAlreadyConsumed`, duplicate withdraw → `Nullifier already spent`

---

### PR-010M: Solana ↔ EVM Bridge Route

**Scope:**
- Deploy Solana bridge accounts to Devnet
- Configure Solana ↔ Base, Solana ↔ Ethereum routes
- Handle asset ID version differences (Solana v1, EVM v2)
- Test commitment derivation across domain boundaries
- Measure Solana CU for threshold verification

**Deliverable:** Solana ↔ EVM routes working.

---

### PR-010N: Watcher / Challenge / Freeze

**Scope:**
- Watcher service that monitors all chains for reorgs
- Freeze UI/API for operators
- Challenge window queue monitoring
- Alerting (Discord/Slack/PagerDuty webhook)
- Dashboard showing route status, pending messages, cap utilization

**Files:**
- `relayer/src/bridge/watcher-service.ts` (new)
- `relayer/src/bridge/alerting.ts` (new)
- `ops/bridge-dashboard/` (new, optional)

**Deliverable:** Operators can freeze messages and routes; alerts fire on anomalies.

---

### PR-010O: Bridge Audit Package

**Scope:**
- Internal security review document
- External audit preparation package
- Testnet public beta announcement
- Public documentation update
- Update `docs/fixes/PR-010-private-bridge-spec.md` with final findings

**Deliverable:** Bridge is ready for external audit and public testnet beta.

---

## 4. Technical Decisions

### 4.1 No New Circuit for v1

**Decision:** Use existing `withdraw` / `withdraw_v2` circuits with `public_data_hash` binding.

**Rationale:**
- Faster time to market.
- Existing circuits are tested and audited.
- On-chain threshold attestation provides sufficient security for v1.

**Cost:** `public_data_hash` only has dummy constraint in-circuit. Semantic binding is on-chain.

**v2 path:** Add dedicated `bridge_withdraw` circuit with proper hash binding.

### 4.2 secp256k1 for Both Chains

**Decision:** Use secp256k1 signatures on both EVM and Solana.

**Rationale:**
- EVM natively supports `ecrecover`.
- Solana supports `secp256k1_recover` precompile.
- Single curve reduces signer infrastructure complexity.

**Status:** Proven on EVM (2-of-3 and 5-of-7). Solana implementation ready, pending devnet test.

### 4.3 Per-Chain Local Merkle Trees

**Decision:** No global Merkle tree in v1.

**Rationale:**
- Simpler implementation.
- Each chain's privacy set is independent.
- No need for cross-chain Merkle proofs.

**Cost:** Smaller anonymity set per chain. Bridge linking heuristics possible.

### 4.4 Operational Rebalancing

**Decision:** Liquidity rebalancing is manual/operational, not automated.

**Rationale:**
- Automated cross-chain rebalancing requires AMMs or atomic swaps.
- Operational rebalancing is sufficient for testnet and early mainnet beta.

**v2 path:** Vault-to-vault swaps or automated market maker integration.

---

## 5. Testing Strategy

| Layer | Test Type | Coverage | Status |
|-------|-----------|----------|--------|
| Message format | Unit (TS/Solidity/Rust) | Cross-language hash parity, validation rules | ✅ Complete |
| EVM contracts | Unit + integration (Foundry) | Threshold verification, caps, pause, replay | ✅ 149 tests pass |
| Solana program | Unit + integration (Anchor) | CPIs, signature verification, CU limits | ✅ 115 tests pass |
| Relayer | Unit + integration (Jest) | Message flow, signature collection, submission | ✅ 210 tests pass |
| E2E | Integration | BridgeOut → sign → BridgeIn → commitment insert → withdraw | ✅ Base↔Ethereum bidirectional proven |
| Fuzz | Property-based | Message decoding, cap edge cases, signature malleability | ⏳ Future |

---

## 6. Open Engineering Questions

1. **Solana devnet deployment:** Need to deploy bridge config accounts and fund them for live E2E.
2. **Relayer daemon mode:** Current relayer bridge service processes events synchronously. Needs background polling loop for production.
3. **Message retry / backoff:** `FAILED` state messages need automatic retry with exponential backoff.
4. **Explorer verification:** Bridge contracts need verification on Basescan/Etherscan for transparency.

---

## 7. Success Criteria

- [x] All core EVM routes have working E2E tests (Base→Ethereum proven).
- [x] Threshold signature verification works on EVM (2-of-3, 5-of-7).
- [x] Replay protection passes integration testing.
- [x] Cap enforcement blocks exceeded transfers.
- [x] Pause/freeze stops all bridge activity within 1 block/slot.
- [x] No secrets logged in relayer.
- [x] Typecheck and build pass for all modified packages.
- [x] Destination withdrawal from bridge-minted commitment proven.
- [x] Duplicate bridge replay and duplicate destination withdraw replay rejected.
- [ ] Solana↔EVM route proven.
- [ ] All 12 EVM↔EVM routes proven.
- [x] Reverse direction (Ethereum→Base) proven.
- [ ] External audit package prepared.
