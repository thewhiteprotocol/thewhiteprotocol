# Private Bridge v1 — Threat Model

**Version:** 1.0  
**Date:** 2026-05-04  
**Status:** Design / Pre-Implementation  
**Scope:** Solana Devnet ↔ Base Sepolia ↔ Ethereum Sepolia ↔ BNB Testnet ↔ Polygon Amoy

---

## 1. Executive Summary

The White Protocol v1 private bridge moves value between per-chain shielded pools without revealing the sender, recipient, or amount. Each chain maintains its own local Merkle tree and liquidity vault. Bridge messages are attested by a threshold signer set. This document catalogs threats, defenses, and residual risks for the v1 design.

**Key design principle:** v1 prioritizes privacy and safety over full trustlessness. A bonded watcher/challenge path and ZK light-client upgrades are planned for v2/v3.

---

## 2. Trust Assumptions

| Actor | Trust Level | Rationale |
|-------|-------------|-----------|
| Threshold signer set | Semi-trusted | 2-of-3 (testnet), 5-of-7 (mainnet beta). Compromise of threshold = unlimited mint. |
| Relayer operators | Semi-trusted | Observe events, submit attestations, never hold private note secrets. |
| Watchers | Semi-trusted | Can freeze suspicious messages before finalization. Manual recovery. |
| Bridge smart contracts/programs | Trusted code | Audited before mainnet. Upgradeable only via timelock. |
| Users | Untrusted | Can attempt replay, front-running, amount manipulation, invalid proofs. |
| Layer-1 sequencers/validators | Trusted for finality | Source chain reorgs can invalidate attestations if finality is insufficient. |

---

## 3. Asset Flow Model

```
Source Chain                    Destination Chain
┌──────────────┐                ┌──────────────┐
│ Shielded Pool│                │ Shielded Pool│
│  (local tree)│                │  (local tree)│
└──────┬───────┘                └──────┬───────┘
       │                               │
       │  1. bridgeOut                 │  4. bridgeMint
       │     - spend source note       │     - insert destination commitment
       │     - record outbound cap     │     - record inbound cap
       │                               │
       ▼                               ▼
┌──────────────┐                ┌──────────────┐
│  Liquidity   │ ── 2. attestation ──▶│  Liquidity   │
│    Vault     │    (threshold sigs)   │    Vault     │
└──────────────┘                └──────────────┘
```

- No global Merkle tree.
- No wrapped IOU tokens.
- Destination commitment is a fresh private note computed off-chain with destination-domain assetId.

---

## 4. Threat Catalog

### 4.1 Infinite Mint / Unauthorized Mint

**Threat:** Attacker forges a bridge attestation and mints unlimited destination commitments.

**Attack vectors:**
- Compromise threshold signer set
- Replay a valid attestation on a different destination chain
- Replay a valid attestation after signer rotation
- Front-run a legitimate attestation with a modified message

**Defenses (v1):**
- Threshold signatures (secp256k1) — compromise requires quorum
- Unique message hash consumed mapping on destination chain
- Nonce per source domain
- Deadline expiration
- Source/destination domain IDs included in attestation hash
- Signer set version included in attestation hash
- Route/asset caps limit maximum damage per message

**Residual risk:** If threshold quorum is compromised, attacker can mint up to route/asset caps. No fully trustless defense in v1.

**Mitigation for v2/v3:** Bonded watchers, ZK light-client inclusion proofs, fraud proofs with slashing.

---

### 4.2 Replay Attacks

**Threat:** Same bridge message is processed multiple times on the same or different chains.

| Replay Type | Defense |
|-------------|---------|
| Same chain replay | Destination maintains `consumedMessageHashes` mapping; `bridgeMint` reverts if hash already consumed. |
| Cross-chain replay | `sourceDomain` + `destinationDomain` + `canonicalAssetId` + `nonce` are in attestation hash. Message valid only for one destination. |
| Wrong destination replay | `destinationDomain` must match destination chain's domainId. |
| Wrong asset replay | `canonicalAssetId` is in attestation hash; destination looks up local asset from canonical ID. |
| Stale attestation replay | `deadline` timestamp; destination rejects expired attestations. |
| Signer-set replay | `signerSetVersion` in attestation hash; old signer-set messages rejected after rotation. |
| Fork/reorg replay | Finality rule + source block number in message; watcher can challenge if source event is orphaned. |

**Residual risk:** Deep reorg on source chain after attestation submission. Mitigated by conservative finality rules.

---

### 4.3 Double Spend on Source Chain

**Threat:** User spends same note twice — once via normal withdrawal, once via bridgeOut.

**Defense:** Source chain `bridgeWithdraw` uses the same nullifier tracking as normal withdrawal. `spentNullifiers` mapping prevents double spend.

**Residual risk:** None (same defense as normal withdrawals).

---

### 4.4 Source Chain Reorg After Attestation

**Threat:** Source chain reorgs, invalidating the BridgeOut event that was already attested and minted on destination.

**Defense:**
- Conservative finality rules per chain (see §5)
- Source block number in message; watcher monitors for reorgs
- If reorg detected post-mint, watcher can freeze route and governance initiates recovery

**Residual risk:** Very deep reorg (e.g., >50 Ethereum blocks) could outrun watcher response.

---

### 4.5 Amount Manipulation

**Threat:** Attacker modifies amount in transit or in proof.

**Defense:**
- Amount is in attestation hash
- ZK proof on source chain enforces amount conservation
- Destination verifies attestation hash matches message fields
- Per-message max amount cap

**Residual risk:** None if proof and attestation are both verified.

---

### 4.6 Invalid Destination Commitment

**Threat:** Attacker inserts a destination commitment that does not correspond to a valid private note.

**Defense:**
- Destination commitment is a public input in the bridge attestation hash
- User must know the preimage (secret, nullifier, amount, assetId) to spend the destination note later
- Invalid commitment simply results in unspendable funds (user's own loss)

**Residual risk:** User error in computing destination commitment. UI/UX must validate commitment derivation.

---

### 4.7 Bridge Operator Front-Running

**Threat:** Relayer sees BridgeOut event and frontruns with modified destination commitment or recipient.

**Defense:**
- Destination commitment is fixed in source chain BridgeOut event
- Attestation hash binds destination commitment
- Relayer cannot change commitment without invalidating threshold signatures
- Recipient is never revealed on-chain (only commitment hash)

**Residual risk:** Relayer can delay or censor attestations. Mitigated by having multiple relayers and open submission.

---

### 4.8 Liquidity Imbalance / Bank Run

**Threat:** Large one-way bridge flows drain a chain's liquidity vault, leaving users unable to withdraw.

**Defense:**
- Per-route daily caps
- Per-asset daily caps
- Per-message max amount
- Operator can pause route
- Emergency global pause
- Operator rebalances liquidity periodically (operational, not protocol)

**Residual risk:** Coordinated bank run can hit caps. Caps are safety valves, not guarantees.

---

### 4.9 Privacy Leakage

**Threat:** Bridge linkage reveals that two notes on different chains belong to the same user.

**Attack vectors:**
- Timing correlation (source BridgeOut and destination BridgeMint timestamps)
- Amount correlation
- Asset correlation
- Same nullifier hash reused (prevented by design)

**Defenses:**
- No recipient address on-chain
- Commitment-based destination note
- Users can add delay between bridgeOut and spending destination note
- Different nullifiers on source and destination
- Amount caps prevent large unique amounts from being fingerprinted

**Residual risk:** Timing/amount heuristics remain possible. Larger anonymity sets and delayed processing help.

---

### 4.10 Contract/Program Exploit

**Threat:** Bug in bridge contract or program allows unauthorized mint or bypass.

**Defense:**
- Audits before mainnet
- Timelock on upgrades
- Emergency pause
- Gradual cap increases
- Testnet soak period

**Residual risk:** Unknown vulnerabilities. Insurance fund recommended for mainnet beta.

---

### 4.11 Denial of Service

**Threat:** Attacker floods bridge with invalid messages, hitting gas limits or caps.

**Defense:**
- Proof verification on source chain prevents invalid messages at source
- Per-IP rate limiting on relayer API
- Per-recipient rate limiting
- Message submission is permissionless but requires valid attestation

**Residual risk:** Valid but low-value messages can consume caps. Fee mechanism discourages spam.

---

## 5. Finality Rules

| Source Chain | Min Confirmations | Block Time | Approx Finality Time | Risk |
|--------------|-------------------|------------|---------------------|------|
| Solana Devnet | 32 slots | ~400ms | ~13s | Low |
| Solana Mainnet-beta | 32 slots | ~400ms | ~13s | Very low |
| Base Sepolia | 10 blocks | 2s | 20s | Low |
| Base Mainnet | 20 blocks | 2s | 40s | Very low |
| Ethereum Sepolia | 12 blocks | 12s | 144s | Low |
| Ethereum Mainnet | 20 blocks | 12s | 240s | Very low |
| BNB Testnet | 15 blocks | 3s | 45s | Low |
| BNB Mainnet | 25 blocks | 3s | 75s | Very low |
| Polygon Amoy | 20 blocks | 2s | 40s | Low |
| Polygon Mainnet | 128 blocks | 2s | 256s | Very low |

**Testnet practical values:** Use the testnet columns above.  
**Mainnet future values:** Use the mainnet columns.

**Watcher role:** Monitor source chain for reorgs deeper than min confirmations. If detected, freeze route immediately.

---

## 6. Cap and Limit Recommendations

| Limit | Testnet Value | Mainnet Beta Value | Who Can Update |
|-------|---------------|-------------------|----------------|
| Per-message max | 10 ETH / 10,000 USDC | 50 ETH / 100,000 USDC | Admin (timelock 24h) |
| Per-route daily | 100 ETH / 100,000 USDC | 500 ETH / 1,000,000 USDC | Admin (timelock 24h) |
| Per-asset daily | 200 ETH / 200,000 USDC | 1,000 ETH / 2,000,000 USDC | Admin (timelock 24h) |
| Global daily | 500 ETH / 500,000 USDC | 2,500 ETH / 5,000,000 USDC | Admin (timelock 48h) |
| Challenge threshold | >1 ETH | >5 ETH | Admin (timelock 24h) |
| Challenge window | 15 minutes | 30 minutes | Admin (timelock 24h) |

---

## 7. Signer Set Security

### 7.1 Key Type
- **Curve:** secp256k1 (same as Ethereum)
- **Rationale:** Single curve across EVM and Solana reduces complexity. Solana supports secp256k1 recovery via `solana_program::secp256k1_recover`.

### 7.2 Threshold
| Environment | Threshold | Rationale |
|-------------|-----------|-----------|
| Local dev | 1-of-1 | Speed |
| Public testnet | 2-of-3 | Basic redundancy |
| Mainnet beta | 5-of-7 | Byzantine fault tolerance |
| Future | Bonded external operators | Decentralization |

### 7.3 Signer Rotation
- New signer set proposed by admin
- 48-hour timelock
- `signerSetVersion` increments
- Old signer set messages invalid after new version is active
- Emergency signer removal: 4-of-7 multisig or admin + 24h timelock

### 7.4 Emergency Procedures
- **Pause route:** Admin or 2-of-3 threshold can pause any route immediately
- **Global pause:** Admin or 3-of-5 threshold
- **Freeze message:** Watcher can freeze individual message before finalization
- **Signer compromise:** Remaining honest signers can rotate out compromised signer via admin proposal + timelock

---

## 8. Residual Risks Accepted in v1

| Risk | Why Accepted | Mitigation Path |
|------|------------|-----------------|
| Threshold trust assumption | Full trustlessness requires ZK light clients | v2: bonded watchers; v3: ZK light clients |
| Watcher manual recovery | Fully automated challenge/slashing is complex | v2: on-chain challenge bonds |
| Timing correlation privacy leak | Delayed processing adds UX friction | v2: batching/mixing |
| Relayer censorship | Permissionless submission reduces but doesn't eliminate | v2: incentivized relayer network |
| Liquidity operator dependency | Automated rebalancing requires AMM integration | v2: vault-to-vault swaps |

---

## 9. Risk Matrix Summary

| Threat | Likelihood | Impact | Risk Level | v1 Defense |
|--------|------------|--------|------------|------------|
| Threshold compromise | Low | Critical | High | Threshold + caps + timelock |
| Replay attack | Medium | High | Medium | Nonce + consumed hashes + domains |
| Source reorg | Low | High | Medium | Finality rules + watcher |
| Double spend | Very low | High | Low | Nullifier tracking |
| Amount manipulation | Very low | Medium | Low | Proof + attestation hash |
| Privacy leakage | Medium | Medium | Medium | Commitment-based notes + delays |
| Contract exploit | Low | Critical | High | Audits + timelock + gradual caps |
| DoS / spam | Medium | Low | Low | Rate limits + fees |
| Liquidity drain | Medium | Medium | Medium | Caps + pause + rebalancing |
