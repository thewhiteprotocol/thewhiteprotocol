# Private Bridge v1 — Specification

**Version:** 1.0  
**Date:** 2026-05-04  
**Status:** Design / Pre-Implementation  
**Chains:** Solana Devnet ↔ Base Sepolia ↔ Ethereum Sepolia ↔ BNB Testnet ↔ Polygon Amoy

---

## 1. Overview

The White Protocol Private Bridge v1 enables users to move value between per-chain shielded pools while preserving privacy. The bridge does not use a global Merkle tree, shared liquidity pool, or wrapped IOU tokens. Instead, it:

1. **Spends** a private note on the source chain.
2. **Attests** the spend via a threshold signer set.
3. **Mints** a fresh private commitment on the destination chain.

Each chain maintains its own local Merkle tree, asset vaults, and liquidity accounting.

---

## 2. Architecture Principles

1. **Per-chain local trees** — No global Merkle tree in v1.
2. **Threshold attestations** — Not trustless, but capped and challengeable.
3. **Domain-separated asset IDs** — v2 asset IDs include chain domainId.
4. **No wrapped IOUs** — Destination note is a real private commitment in the local pool.
5. **Capped exposure** — Route/asset caps limit maximum loss from threshold compromise.
6. **Honest about trust model** — v1 is semi-trusted. v2/v3 will add watchers and ZK light clients.

---

## 3. Supported Routes

| Source | Destination | Status in v1 |
|--------|-------------|--------------|
| Solana Devnet | Base Sepolia | ✅ Planned |
| Solana Devnet | Ethereum Sepolia | ✅ Planned |
| Solana Devnet | BNB Testnet | ✅ Planned |
| Solana Devnet | Polygon Amoy | ✅ Planned |
| Base Sepolia | Ethereum Sepolia | ✅ Planned |
| Base Sepolia | BNB Testnet | ✅ Planned |
| Base Sepolia | Polygon Amoy | ✅ Planned |
| Base Sepolia | Solana Devnet | ✅ Planned |
| Ethereum Sepolia | Base Sepolia | ✅ Planned |
| Ethereum Sepolia | BNB Testnet | ✅ Planned |
| Ethereum Sepolia | Polygon Amoy | ✅ Planned |
| Ethereum Sepolia | Solana Devnet | ✅ Planned |
| BNB Testnet | Base Sepolia | ✅ Planned |
| BNB Testnet | Ethereum Sepolia | ✅ Planned |
| BNB Testnet | Polygon Amoy | ✅ Planned |
| BNB Testnet | Solana Devnet | ✅ Planned |
| Polygon Amoy | Base Sepolia | ✅ Planned |
| Polygon Amoy | Ethereum Sepolia | ✅ Planned |
| Polygon Amoy | BNB Testnet | ✅ Planned |
| Polygon Amoy | Solana Devnet | ✅ Planned |

**Note:** v1 enables all 20 directed routes. Caps are per-route.

---

## 4. Trust Model

### 4.1 Signer Set

| Environment | Threshold | Members | Curve |
|-------------|-----------|---------|-------|
| Local dev | 1-of-1 | Operator | secp256k1 |
| Public testnet | 2-of-3 | Team + external | secp256k1 |
| Mainnet beta | 5-of-7 | Team + custodians + community | secp256k1 |

**Why secp256k1?**
- EVM natively supports `ecrecover`.
- Solana supports `solana_program::secp256k1_recover` (precompile).
- Single curve reduces v1 complexity.

### 4.2 Signer Lifecycle

1. **Initial setup:** Admin sets initial signer set and threshold.
2. **Rotation:** Admin proposes new signer set → 48h timelock → `signerSetVersion` increments.
3. **Emergency removal:** Admin + 24h timelock can remove a signer.
4. **Message validity:** Messages include `signerSetVersion`. Destination rejects messages from old signer sets.

### 4.3 Watcher Model (v1)

- Watchers monitor source chains for reorgs and destination chains for suspicious mints.
- Any watcher can **freeze** a specific message or an entire route before finalization.
- Frozen messages require manual governance review.
- Watchers are **not** bonded or slashed in v1. Bonded challenge/slashing is v2.

---

## 5. Liquidity Model

### 5.1 Per-Chain Vaults

Each chain has:
- **Pool asset vaults:** Existing shielded pool vaults hold tokens backing private notes.
- **Bridge liquidity accounting:** `bridgeOutgoing[asset]` tracks outbound obligations. `bridgeIncoming[asset]` tracks inbound obligations.

### 5.2 Source Chain: bridgeOut

1. User generates ZK proof spending source note.
2. Source contract verifies proof, marks nullifier spent.
3. Source contract increments `bridgeOutgoing[asset] += amount`.
4. Tokens remain in pool vault (accounting only).
5. BridgeOut event emitted.

### 5.3 Destination Chain: bridgeMint

1. Threshold attestation submitted.
2. Destination contract verifies threshold, checks caps.
3. Destination contract increments `bridgeIncoming[asset] += amount`.
4. Destination commitment inserted into local Merkle tree.
5. BridgeMint event emitted.

### 5.4 Solvency

The invariant: `vaultBalance >= totalNotes + bridgeOutgoing - bridgeIncoming`.

- No automatic solvency check in v1 (too expensive on-chain).
- Operator monitors solvency off-chain.
- If a chain becomes undercollateralized, operator rebalances or pauses routes.

### 5.5 Rebalancing

Rebalancing is **operational**, not protocol:
- Operator manually transfers tokens between chain vaults via normal withdrawals/deposits.
- Rebalancing does not affect private notes or bridge accounting.

---

## 6. Source Chain Bridge Flow (bridgeOut)

### 6.1 User Steps (Off-Chain)

1. **Select destination:** User chooses `destinationChainKey` and `destinationToken`.
2. **Compute destination assetId:**
   ```
   assetId_dst = computeAssetIdV2(destinationToken, destinationDomainId)
   ```
3. **Generate destination note:**
   ```
   secret_dst = random(32 bytes)
   nullifier_dst = random(32 bytes)
   commitment_dst = Poseidon(secret_dst, nullifier_dst, amount, assetId_dst)
   ```
4. **Prepare bridge message fields:**
   ```
   sourceDomain, destinationDomain, canonicalAssetId,
   amount, sourceNullifierHash, destinationCommitment,
   sourceNonce, deadline, relayerFee
   ```
5. **Compute extDataHash / public_data_hash:**
   ```
   public_data_hash = keccak256(
     "WHITE_BRIDGE_V1",
     sourceDomain, destinationDomain,
     canonicalAssetId, amount,
     sourceNullifierHash, destinationCommitment,
     sourceNonce, deadline, relayerFee
   )
   ```
6. **Generate source withdraw proof:** Using standard `withdraw` or `withdraw_v2` circuit, with `public_data_hash` as public input.
7. **Submit `bridgeOut` transaction** to source chain contract/program.

### 6.2 Source Contract Verification

**EVM (`WhiteProtocol.bridgeWithdraw`):**
- `onlyBridge` modifier
- Verify Groth16 proof (including `public_data_hash` as public signal)
- Check nullifier not spent
- Check amount within asset limits
- Mark nullifier spent
- `bridgeOutgoing[asset] += amount`
- Emit `BridgeWithdraw(proof, nullifierHash, asset, amount, extDataHash)`

**Solana (`white_protocol::bridge_withdraw`):**
- `bridge_authority` must sign
- Verify Groth16 proof
- Check `SpentNullifier` PDA does not exist
- Init `SpentNullifier` PDA
- Transfer tokens from vault to bridge token account
- `asset_vault.shielded_balance -= amount`
- Emit `BridgeWithdraw` event

### 6.3 Bridge Transport Event

**EVM (`WhiteBridge.bridgeOut`):**
- Call `whiteProtocol.bridgeWithdraw(...)`
- Encode bridge message (see message format spec)
- Increment `localNonce`
- Emit `BridgeOut(message, localNonce, dstEid)`
- **v1 change:** Emit `BridgeOut` event with full canonical message (not just LZ payload)

**Solana (`white_bridge_solana::bridge_out`):**
- CPI into `white_protocol::bridge_withdraw(...)`
- Encode bridge message
- Emit `BridgeOut` event
- **v1 change:** Store outbound nonce in bridge program state

---

## 7. Destination Chain Bridge Flow (bridgeMint)

### 7.1 Relayer Steps

1. **Observe:** Listen for `BridgeOut` events on source chain.
2. **Wait for finality:** Wait for source block confirmations (see Finality Rules).
3. **Build attestation:** Construct canonical message hash.
4. **Collect signatures:** Request threshold signers to sign message hash.
5. **Submit:** Call `bridgeMint` on destination chain with message + signatures.

### 7.2 Destination Contract Verification

**EVM (`WhiteProtocol.bridgeMint` via `WhiteBridge._lzReceive` or direct inbox):**

New verification steps for v1:
1. Verify threshold signatures on message hash
2. Check `signerSetVersion` matches current version
3. Check `destinationDomain == this.domainId`
4. Check `sourceDomain` is in `allowedSourceDomains`
5. Check route `(sourceDomain, destinationDomain)` is enabled
6. Check `canonicalAssetId` is supported
7. Check `messageHash` not in `consumedMessageHashes`
8. Check `amount <= perMessageMax`
9. Check `totalInflow[canonicalAssetId] + amount <= perAssetDailyCap`
10. Check `totalRouteInflow[route] + amount <= perRouteDailyCap`
11. Check `block.timestamp <= deadline`
12. Check `sourceBlockNumber + finalityBlocks <= currentBlockNumber`
13. If amount > challengeThreshold: queue for challenge window
14. Otherwise: proceed immediately
15. Insert `destinationCommitment` into Merkle tree
16. Mark `consumedMessageHashes[messageHash] = true`
17. `bridgeIncoming[asset] += amount`
18. Emit `BridgeMint(messageHash, destinationCommitment, asset, amount)`

**Solana (`white_protocol::bridge_mint`):**

New verification steps for v1:
1. Verify threshold signatures (via secp256k1 recovery instruction)
2. Check `signer_set_version` matches
3. Check `destination_domain == this_domain`
4. Check route enabled in `RouteConfig` PDA
5. Check `canonical_asset_id` supported
6. Check `message_hash` not in `ConsumedMessage` PDA
7. Check caps (per-message, per-asset, per-route)
8. Check deadline (slot-based or timestamp-based)
9. If amount > challenge_threshold: queue in `PendingChallenge` PDA
10. Otherwise: transfer tokens from bridge token account to vault
11. Insert commitment into pending buffer
12. Init `ConsumedMessage` PDA
13. Emit `BridgeMint` event

### 7.3 Challenge Window (Optional for v1)

For amounts > challengeThreshold:
1. Commitment is queued but not yet inserted into Merkle tree.
2. Challenge window starts (e.g., 15 min testnet / 30 min mainnet).
3. Watchers can freeze the message.
4. If no freeze: commitment is inserted after window expires.
5. If frozen: governance reviews. If legitimate: insert. If fraudulent: discard.

---

## 8. Asset ID Mapping

### 8.1 Canonical Asset IDs

Cross-chain canonical IDs map asset types, not chain-specific addresses:

| Canonical ID | Asset Type | Example Local Addresses |
|--------------|------------|------------------------|
| 1 | ETH / native gas token | Base WETH, Ethereum WETH, BNB WBNB, Polygon WMATIC, Solana wSOL |
| 2 | USDC | Base USDC, Ethereum USDC, BNB USDC, Polygon USDC, Solana USDC |
| 3 | USDT | Base USDT, Ethereum USDT, BNB USDT, Polygon USDT, Solana USDT |
| 10 | POL | Polygon POL |
| 11 | BNB | BNB Chain BNB |
| 100+ | Reserved for future assets | — |

### 8.2 Local Asset ID Computation

**EVM v2:**
```
assetId = 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || tokenAddress)[0..31]
```

**Solana v1:**
```
assetId = 0x00 || keccak256("white:asset_id:v1" || mintPubkey)[0..31]
```

**Note:** Solana currently uses v1 asset IDs. Bridge messages use canonical IDs for cross-chain transport. The user computes the destination commitment using the destination chain's local assetId (v2 for EVM, v1 for Solana).

---

## 9. Signer / Attestation Requirements

### 9.1 EVM Contract Requirements

New contract (or extension of `WhiteBridge`):

```solidity
struct SignerSet {
    address[] signers;
    uint256 threshold;
    uint256 version;
    uint256 activeAt;
}

mapping(uint256 => SignerSet) public signerSets;
uint256 public currentSignerSetVersion;
mapping(bytes32 => bool) public consumedMessageHashes;

// Cap state
mapping(bytes32 => uint256) public dailyInflow; // keyed by canonicalAssetId + day
mapping(bytes32 => uint256) public dailyRouteInflow; // keyed by routeKey + day

function verifyThresholdSignatures(
    bytes32 messageHash,
    bytes[] calldata signatures,
    uint256 signerSetVersion
) internal view returns (bool) {
    SignerSet storage set = signerSets[signerSetVersion];
    require(block.timestamp >= set.activeAt, "Signer set not active");
    require(signatures.length >= set.threshold, "Insufficient signatures");
    
    uint256 validCount = 0;
    address lastSigner = address(0);
    for (uint i = 0; i < signatures.length; i++) {
        address signer = ecrecover(messageHash, ...);
        require(_isSigner(signer, set), "Invalid signer");
        require(signer > lastSigner, "Signatures must be sorted"); // prevent duplicate
        validCount++;
        lastSigner = signer;
    }
    return validCount >= set.threshold;
}
```

### 9.2 Solana Program Requirements

New accounts for v1:

```rust
// SignerSet PDA: seeds = [b"signer_set", version]
pub struct SignerSet {
    pub version: u64,
    pub threshold: u8,
    pub signers: Vec<[u8; 33]>, // compressed secp256k1 pubkeys
    pub active_at: i64,
    pub bump: u8,
}

// ConsumedMessage PDA: seeds = [b"consumed", message_hash]
pub struct ConsumedMessage {
    pub message_hash: [u8; 32],
    pub consumed_at: i64,
    pub bump: u8,
}

// RouteConfig PDA: seeds = [b"route", source_domain, dest_domain]
pub struct RouteConfig {
    pub source_domain: u32,
    pub destination_domain: u32,
    pub enabled: bool,
    pub per_message_max: u64,
    pub daily_cap: u64,
    pub challenge_threshold: u64,
    pub challenge_window_seconds: u64,
    pub bump: u8,
}

// AssetRouteConfig PDA: seeds = [b"asset_route", canonical_asset_id]
pub struct AssetRouteConfig {
    pub canonical_asset_id: u32,
    pub enabled: bool,
    pub daily_cap: u64,
    pub bump: u8,
}
```

**Signature verification on Solana:**
Use Solana's native `secp256k1` program or `solana_program::secp256k1_recover`:

```rust
use solana_program::secp256k1_recover::secp256k1_recover;

fn verify_secp256k1_signature(
    message_hash: &[u8; 32],
    signature: &[u8; 64],
    recovery_id: u8,
    expected_pubkey: &[u8; 33], // compressed
) -> Result<bool, ProgramError> {
    let pubkey = secp256k1_recover(message_hash, recovery_id, signature)
        .map_err(|_| ProgramError::InvalidArgument)?;
    let compressed = pubkey.to_compressed_pubkey();
    Ok(&compressed == expected_pubkey)
}
```

**Note:** Solana's `secp256k1_recover` returns 64-byte uncompressed pubkey. Must compress or compare uncompressed. Alternatively, store uncompressed pubkeys in `SignerSet`.

---

## 10. Pause, Freeze, and Emergency Controls

### 10.1 EVM

```solidity
// Global pause
bool public globalPaused;
function setGlobalPaused(bool paused) external onlyAdmin;

// Route pause
mapping(bytes32 => bool) public routePaused; // key = keccak256(srcDomain, dstDomain)
function setRoutePaused(uint32 srcDomain, uint32 dstDomain, bool paused) external onlyAdmin;

// Asset pause
mapping(uint32 => bool) public assetPaused; // key = canonicalAssetId
function setAssetPaused(uint32 canonicalAssetId, bool paused) external onlyAdmin;
```

### 10.2 Solana

```rust
// In BridgeConfig
pub struct BridgeConfig {
    pub authority: Pubkey,
    pub global_paused: bool,
    pub signer_set_version: u64,
    pub bump: u8,
}

// RouteConfig has `enabled: bool`
// AssetRouteConfig has `enabled: bool`
```

### 10.3 Watcher Freeze

- Any address can call `freezeMessage(messageHash)` within the challenge window.
- Frozen messages cannot be finalized until governance calls `unfreezeMessage(messageHash)` or `rejectMessage(messageHash)`.
- No bond required in v1.

---

## 11. Finality Requirements

See [Threat Model §5](private-bridge-threat-model.md#5-finality-rules) for per-chain values.

**Relayer implementation:**
- Track `sourceBlockNumber` from BridgeOut event.
- Wait until `currentBlockNumber >= sourceBlockNumber + finalityConfirmations`.
- Include `sourceBlockNumber` in attestation so destination can verify.

---

## 12. Circuit Impact Analysis

### 12.1 Current State

- No bridge-specific circuits exist.
- Standard `withdraw` / `withdraw_v2` circuits are used.
- `public_data_hash` is a public input but only has a **dummy constraint** in-circuit.
- Semantic binding of `public_data_hash` happens **on-chain**.

### 12.2 v1 Recommendation: No New Circuit

For v1, keep the existing pattern:
1. User computes `public_data_hash = keccak256(bridge_message_fields)` off-chain.
2. User generates standard withdraw proof with `public_data_hash` as public signal.
3. Source contract verifies proof and checks that `public_data_hash` matches expected bridge metadata.

**Rationale:**
- Faster time-to-market for v1.
- Existing circuits are audited and tested.
- On-chain binding is sufficient for a threshold-attestation bridge.

### 12.3 v2 Recommendation: Bridge Withdraw Circuit

Add a dedicated `bridge_withdraw` circuit that:
1. Takes private inputs: `dstDomain`, `canonicalAssetId`, `newCommitment`.
2. Constrains: `public_data_hash == keccak256(dstDomain, canonicalAssetId, amount, newCommitment, nonce, deadline)`.
3. Optionally constrains `recipient == bridgeVaultAddress`.

This removes the "dummy constraint" issue and provides stronger cryptographic binding.

---

## 13. Relayer Requirements

### 13.1 Components

| Component | Responsibility |
|-----------|---------------|
| Event Watcher | Poll/filter `BridgeOut` events on all source chains |
| Finality Tracker | Track block confirmations per chain |
| Attestation Builder | Construct canonical message hash from event data |
| Signer Client | Hold signer key, sign message hashes |
| Signature Aggregator | Collect threshold signatures from signer set |
| Destination Submitter | Submit `bridgeMint` transactions |
| Message Store | Persist observed messages, signatures, submission state |
| Cap Monitor | Track daily caps per route/asset |
| Watcher Client | Monitor for reorgs and suspicious patterns |

### 13.2 Security Requirements

- **No secret logging:** Never log note secrets, nullifier preimages, or private keys.
- **Deterministic message hash:** All signers must compute identical message hashes.
- **Idempotent submission:** Destination submitter must handle `consumedMessageHashes` revert gracefully.
- **RPC failover:** Per-chain RPC with fallback endpoints.
- **Gas handling:** Chain-specific gas estimation + buffer (reusing PR-009C logic).

### 13.3 Message Store Schema

```typescript
interface BridgeMessageRecord {
  messageHash: string;
  sourceChain: string;
  destinationChain: string;
  sourceTxHash: string;
  sourceBlockNumber: number;
  sourceNonce: bigint;
  status: 'observed' | 'finalized' | 'signed' | 'submitted' | 'confirmed' | 'frozen' | 'failed';
  signatures: Array<{ signerIndex: number; signature: string }>;
  destinationTxHash?: string;
  createdAt: number;
  updatedAt: number;
}
```

---

## 14. Implementation PR Sequence

| PR | Scope | Dependencies |
|----|-------|--------------|
| **PR-010B** | Bridge message format library + typed hash + unit tests | None |
| **PR-010C** | EVM BridgeInbox/Outbox contracts (threshold sigs, caps, pause) | PR-010B |
| **PR-010D** | Solana bridge program: signer set, consumed messages, route config, secp256k1 verification | PR-010B |
| **PR-010E** | Relayer bridge service: event watcher, attestation builder, signer client, destination submitter | PR-010C, PR-010D |
| **PR-010F** | Base ↔ Ethereum E2E private bridge test | PR-010E |
| **PR-010G** | BNB Chain + Polygon EVM bridge routes | PR-010F |
| **PR-010H** | Solana ↔ EVM bridge route | PR-010G |
| **PR-010I** | Watcher/challenge/freeze UI and monitoring | PR-010H |
| **PR-010J** | Bridge audit package + docs + testnet public beta | PR-010I |

---

## 15. Public Claims Safety

### Safe to Claim
- ✅ "Multi-chain private deposits and withdrawals are live on testnets."
- ✅ "Private bridge architecture has been designed with threshold attestations, domain separation, and route caps."
- ✅ "Bridge v1 uses per-chain local Merkle trees — no global root or wrapped IOUs."

### Unsafe to Claim
- ❌ "Private bridge is fully trustless." (v1 requires threshold signer trust)
- ❌ "Private bridge is live on mainnet." (testnet only until audit)
- ❌ "Global anonymity set across all chains." (per-chain sets in v1)
- ❌ "Bridge cannot be paused or frozen." (pause/freeze exists)
- ❌ "Zero-knowledge light clients verify bridge messages." (v3 feature)

---

## 16. Open Questions

1. **Solana secp256k1 verification cost:** Must measure CU for `secp256k1_recover` in a multi-sig context. If >100k CU per signature, threshold verification may be expensive.
2. **Solana bridge program programId:** Replace placeholder `So11111111111111111111111111111111111111112` with real keypair.
3. **Challenge window mechanism:** Should v1 implement on-chain challenge queues or off-chain watcher + admin manual review?
4. **Daily cap reset:** Midnight UTC or rolling 24h window?
5. **Canonical asset ID authority:** Who assigns new canonical IDs? Admin-only or governance?
