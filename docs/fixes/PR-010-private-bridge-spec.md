# PR-010 — Private Bridge Threat Model and v1 Specification

**Date:** 2026-05-04  
**Status:** ✅ COMPLETE (Design Phase)  
**Scope:** Read-only audit and specification. No runtime code modified.

---

## 1. Summary

PR-010 completed a comprehensive audit of existing bridge code and produced a full v1 private bridge specification. The specification covers:

- Threat model with 10+ cataloged threats and defenses
- v1 trust model (threshold signer set, 2-of-3 testnet / 5-of-7 mainnet beta)
- Per-chain liquidity model (no global Merkle tree, no wrapped IOUs)
- Canonical bridge message format (237 bytes, domain-separated)
- Source and destination bridge flows
- Replay protection matrix (8 replay types cataloged)
- Route and asset caps
- Watcher/challenge/freeze model
- EVM and Solana implementation requirements
- Relayer bridge service architecture
- Honest circuit impact analysis (v1: no new circuit; v2: dedicated bridge circuit)
- Concrete implementation PR sequence (PR-010B through PR-010J)
- Public claims safety guidelines

**No runtime code, contracts, circuits, or programs were modified.**

---

## 2. Existing Bridge Code Audit

### 2.1 EVM Layer

| Component | Status | Reusable? | Key Gap |
|-----------|--------|-----------|---------|
| `WhiteBridge.sol` | Real (LZ OApp) | Partial | No threshold signatures; no pause |
| `BridgeAssetRegistry.sol` | Real | Yes | No per-asset pause |
| `WhiteProtocol.sol` hooks | Real | Yes | Clean interface |
| Tests | Good coverage | Yes | Mock verifiers only |

### 2.2 Solana Layer

| Component | Status | Reusable? | Key Gap |
|-----------|--------|-----------|---------|
| `bridge_withdraw` | Real | Yes | No bridge-specific caps |
| `bridge_mint` | Real | Yes | No threshold verification |
| `BridgeConfig` | Real | Yes | Simple authority only |
| `white-bridge-solana` | **Stubbed** | **No** | No CPIs, placeholder program ID |
| Tests | Partial | — | CU measured but not fully integrated |

### 2.3 Relayer Layer

| Component | Status | Reusable? | Key Gap |
|-----------|--------|-----------|---------|
| Bridge watcher | **Missing** | N/A | Build from scratch |
| Attestation builder | **Missing** | N/A | Build from scratch |
| Signer client | **Missing** | N/A | Build from scratch |
| Destination submitter | **Missing** | N/A | Build from scratch |

### 2.4 Circuit Layer

| Component | Status | Reusable? | Key Gap |
|-----------|--------|-----------|---------|
| Bridge circuit | **None** | N/A | v1: reuse withdraw + `public_data_hash` |
| `public_data_hash` binding | Dummy constraint | Partial | On-chain binding only |

### 2.5 Core Package Layer

| Component | Status | Reusable? |
|-----------|--------|-----------|
| `domains.ts` | Real | Yes — domain registry |
| `crypto.ts` | Real | Yes — assetId v1/v2 |
| Bridge message builder | **Missing** | Build in PR-010B |

---

## 3. v1 Design Decisions

### 3.1 Trust Model
- **Testnet:** 2-of-3 threshold, secp256k1
- **Mainnet beta:** 5-of-7 threshold, secp256k1
- **Why secp256k1 on Solana?** `solana_program::secp256k1_recover` is available. Single curve reduces infrastructure complexity.

### 3.2 Liquidity Model
- Per-chain local vaults
- Source note spent → outbound obligation recorded
- Destination commitment inserted → inbound obligation recorded
- Operator rebalances manually (operational, not protocol)
- No global Merkle tree
- No wrapped IOU tokens

### 3.3 Circuit Strategy
- **v1:** No new circuit. Reuse existing `withdraw`/`withdraw_v2` with `public_data_hash` bound to bridge message fields on-chain.
- **v2:** Add dedicated `bridge_withdraw` circuit with proper `public_data_hash` hash constraint.

### 3.4 Message Transport
- EVM↔EVM: Can reuse LayerZero OApp or direct relayer submission.
- Solana↔EVM: Direct relayer submission (Solana bridge program CPIs into core program).

---

## 4. Specification Documents Created

| Document | Purpose |
|----------|---------|
| `docs/bridge/private-bridge-threat-model.md` | Threat catalog, risk matrix, finality rules, cap recommendations, signer security |
| `docs/bridge/private-bridge-v1-spec.md` | Full architecture spec: liquidity model, source/destination flows, asset ID mapping, signer requirements, pause/freeze, relayer requirements, PR sequence |
| `docs/bridge/private-bridge-message-format.md` | Canonical message fields (249 bytes), attestation hash (EVM + Solana), signature format, wire encoding, validation rules, examples |
| `docs/bridge/private-bridge-implementation-plan.md` | Concrete PR sequence, existing code matrix, technical decisions, testing strategy, open engineering questions |

---

## 5. Implementation PR Sequence

| PR | Scope | Effort Estimate |
|----|-------|-----------------|
| **PR-010B** | Bridge message format library (TS + Solidity + Rust) + cross-language hash parity tests | Medium |
| **PR-010C** | EVM BridgeInbox/Outbox with threshold sigs, caps, pause, freeze | Large |
| **PR-010D** | Solana bridge program rewrite: CPIs, secp256k1 verify, PDAs, CU analysis | Large |
| **PR-010E** | Relayer bridge service: watcher, attestation, signer client, submitter, store | Large |
| **PR-010F** | Base ↔ Ethereum E2E private bridge | Medium |
| **PR-010G** | BNB Chain + Polygon EVM routes | Medium |
| **PR-010H** | Solana ↔ EVM bridge route | Large |
| **PR-010I** | Watcher/challenge/freeze + alerting + dashboard | Medium |
| **PR-010J** | Audit package + public testnet beta | Medium |

---

## 6. Public Claims Safety

### Safe to Claim
- ✅ "Multi-chain private deposits and withdrawals are live on testnets."
- ✅ "Private bridge v1 architecture has been designed with threshold attestations, domain separation, and route caps."
- ✅ "Per-chain local Merkle trees — no global root or wrapped IOUs in v1."

### Unsafe to Claim
- ❌ "Private bridge is fully trustless." (v1 requires threshold signer trust)
- ❌ "Private bridge is live on mainnet." (testnet only until audit)
- ❌ "Global anonymity set across all chains." (per-chain sets in v1)
- ❌ "ZK light clients verify bridge messages." (v3 feature)

---

## 7. Critical Gaps to Address First

1. **Solana bridge program is stubbed** — No CPIs, wrong program ID. Must be rewritten.
2. **Relayer has zero bridge code** — Entire bridge service must be built.
3. **No threshold signature mechanism** — Must be added to both EVM and Solana.
4. **No pause/freeze in EVM bridge** — Must be added for safety.
5. **public_data_hash has dummy circuit constraint** — Acceptable for v1 but must be fixed in v2.

---

## 8. Open Questions for v1 Engineering

1. Solana CU cost for multiple `secp256k1_recover` calls — needs measurement.
2. Solana bridge program programId — replace placeholder.
3. Challenge window: on-chain queue or off-chain watcher + manual review?
4. Daily cap reset: block-based or time-based?
5. Signer communication protocol: REST, message queue, or gossip?

---

## 9. Next Recommended PR

**PR-010B — Bridge Message Format Library**

This is the foundational PR. All subsequent PRs depend on a canonical, cross-language message format. Building this first ensures EVM, Solana, and relayer teams work from the same spec.
