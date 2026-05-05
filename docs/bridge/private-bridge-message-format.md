# Private Bridge v1 — Message Format Specification

**Version:** 1.0  
**Date:** 2026-05-04  
**Status:** Design / Pre-Implementation

---

## 1. Design Goals

1. **Deterministic:** All signers and verifiers compute identical message hashes.
2. **Domain-separated:** `sourceDomain` and `destinationDomain` prevent cross-chain replay.
3. **Compact:** Minimize on-chain storage and calldata costs.
4. **Extensible:** Reserved fields for v2 features.
5. **Hash-friendly:** Uses keccak256 for EVM/Solana compatibility.

---

## 2. Canonical Bridge Message

### 2.1 Fields

| Field | Type | Size | Description |
|-------|------|------|-------------|
| `protocolVersion` | uint8 | 1 byte | `1` for v1 |
| `sourceDomain` | uint32 | 4 bytes | Source chain domain ID |
| `destinationDomain` | uint32 | 4 bytes | Destination chain domain ID |
| `sourceChainId` | uint64 | 8 bytes | Source chain L1 ID (EVM chainId or Solana cluster identifier) |
| `destinationChainId` | uint64 | 8 bytes | Destination chain L1 ID |
| `canonicalAssetId` | uint32 | 4 bytes | Cross-chain canonical asset type |
| `amount` | uint64 | 8 bytes | Amount in smallest unit |
| `sourceNullifierHash` | bytes32 | 32 bytes | Nullifier hash spent on source chain |
| `destinationCommitment` | bytes32 | 32 bytes | New commitment hash for destination chain |
| `sourceTxHash` | bytes32 | 32 bytes | Source transaction hash |
| `sourceBlockNumber` | uint64 | 8 bytes | Source block number at BridgeOut |
| `sourceNonce` | uint64 | 8 bytes | Monotonic nonce from source bridge contract |
| `deadline` | uint64 | 8 bytes | Unix timestamp after which message is invalid |
| `relayerFee` | uint64 | 8 bytes | Fee deducted from amount for relayer |
| `signerSetVersion` | uint64 | 8 bytes | Signer set version used for attestation |
| `memoHash` | bytes32 | 32 bytes | Optional memo hash (zeroes if unused) |
| `reserved` | bytes32 | 32 bytes | Reserved for future use |

**Total fixed size:** 1 + 4 + 4 + 8 + 8 + 4 + 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 8 + 32 + 32 = **249 bytes**

### 2.2 Domain IDs

| Chain | domainId | sourceChainId |
|-------|----------|---------------|
| Solana Devnet | 33554433 | 0x01000002 |
| Base Sepolia | 33554434 | 84532 |
| Ethereum Sepolia | 33554435 | 11155111 |
| Polygon Amoy | 33554436 | 80002 |
| BNB Testnet | 33554438 | 97 |
| Base Mainnet | 33554439 | 8453 |
| Ethereum Mainnet | 33554440 | 1 |
| Polygon Mainnet | 33554441 | 137 |
| BNB Mainnet | 33554443 | 56 |

Domain ID structure (from `packages/core/src/domains.ts`):
```
domainId = (family << 24) | networkId
family: 0x01 = Solana, 0x02 = EVM
networkId: sequential per network
```

### 2.3 Canonical Asset IDs

| canonicalAssetId | Asset |
|------------------|-------|
| 1 | ETH / native gas equivalent |
| 2 | USDC |
| 3 | USDT |
| 10 | POL |
| 11 | BNB |
| 100+ | Reserved |

---

## 3. Attestation Hash

The hash that signers sign and verifiers check:

### 3.1 EVM (keccak256)

```solidity
bytes32 constant BRIDGE_ATTESTATION_TYPEHASH = keccak256(
    "WhitePrivateBridgeAttestationV1("
    "uint8 protocolVersion,"
    "uint32 sourceDomain,"
    "uint32 destinationDomain,"
    "uint64 sourceChainId,"
    "uint64 destinationChainId,"
    "uint32 canonicalAssetId,"
    "uint64 amount,"
    "bytes32 sourceNullifierHash,"
    "bytes32 destinationCommitment,"
    "bytes32 sourceTxHash,"
    "uint64 sourceBlockNumber,"
    "uint64 sourceNonce,"
    "uint64 deadline,"
    "uint64 relayerFee,"
    "uint64 signerSetVersion,"
    "bytes32 memoHash"
    ")"
);

bytes32 messageHash = keccak256(abi.encode(
    BRIDGE_ATTESTATION_TYPEHASH,
    protocolVersion,
    sourceDomain,
    destinationDomain,
    sourceChainId,
    destinationChainId,
    canonicalAssetId,
    amount,
    sourceNullifierHash,
    destinationCommitment,
    sourceTxHash,
    sourceBlockNumber,
    sourceNonce,
    deadline,
    relayerFee,
    signerSetVersion,
    memoHash
));
```

### 3.2 Solana (keccak256)

```rust
use solana_program::keccak::hashv;

let message_hash = hashv(&[
    b"WhitePrivateBridgeAttestationV1",
    &protocol_version.to_be_bytes(),
    &source_domain.to_be_bytes(),
    &destination_domain.to_be_bytes(),
    &source_chain_id.to_be_bytes(),
    &destination_chain_id.to_be_bytes(),
    &canonical_asset_id.to_be_bytes(),
    &amount.to_be_bytes(),
    source_nullifier_hash,
    destination_commitment,
    source_tx_hash,
    &source_block_number.to_be_bytes(),
    &source_nonce.to_be_bytes(),
    &deadline.to_be_bytes(),
    &relayer_fee.to_be_bytes(),
    &signer_set_version.to_be_bytes(),
    memo_hash,
]);
```

**Important:** Both EVM and Solana must compute **identical** `messageHash` bytes. The encoding must be unambiguous:
- All integers are **big-endian**.
- All fixed-size byte arrays are concatenated directly.
- No dynamic-length types (strings, arrays) in the hash input.

---

## 4. Signature Format

### 4.1 secp256k1 Signature

```
Signature: 65 bytes
  r: 32 bytes
  s: 32 bytes
  v: 1 byte (recovery id: 27 or 28 for legacy, 0 or 1 for EIP-155 compatible)
```

For v1, use **EIP-191 personal_sign** style:
```
sign(keccak256("\x19Ethereum Signed Message:\n32" + messageHash))
```

**Solana verification:** Use `secp256k1_recover` on the raw `messageHash` (without EIP-191 prefix), or require signers to sign the raw hash. **Decision for v1:** Sign raw `messageHash` directly (no EIP-191 prefix) to simplify Solana verification.

### 4.2 Signature Ordering

Signatures in the `bridgeMint` transaction must be sorted by signer public key (lexicographic, ascending) to prevent duplicate signatures from the same signer.

---

## 5. Wire Format

### 5.1 EVM Calldata

```solidity
struct BridgeAttestation {
    BridgeMessage message;
    bytes[] signatures;
}

struct BridgeMessage {
    uint8 protocolVersion;
    uint32 sourceDomain;
    uint32 destinationDomain;
    uint64 sourceChainId;
    uint64 destinationChainId;
    uint32 canonicalAssetId;
    uint64 amount;
    bytes32 sourceNullifierHash;
    bytes32 destinationCommitment;
    bytes32 sourceTxHash;
    uint64 sourceBlockNumber;
    uint64 sourceNonce;
    uint64 deadline;
    uint64 relayerFee;
    uint64 signerSetVersion;
    bytes32 memoHash;
    bytes32 reserved;
}
```

### 5.2 Solana Account Context

```rust
// bridge_mint instruction accounts:
// 0. payer (signer, mut)
// 1. bridge_config (mut)
// 2. signer_set PDA
// 3. consumed_message PDA (mut, init_if_needed)
// 4. route_config PDA
// 5. asset_route_config PDA
// 6. pool_config
// 7. merkle_tree (mut)
// 8. pending_buffer (mut)
// 9. asset_vault (mut)
// 10. vault_token_account (mut)
// 11. bridge_token_account (mut)
// 12. commitment_index PDA (mut, init_if_needed)
// 13. system_program
// 14. token_program
// 15. sysvar: instructions (for secp256k1 verification)
// 16..N. additional accounts as needed
```

### 5.3 Binary Encoding for P2P / Relayer

For relayer-to-relayer or relayer-to-signer communication:

```
[0]     protocolVersion: u8 = 0x01
[1-4]   sourceDomain: u32 (BE)
[5-8]   destinationDomain: u32 (BE)
[9-16]  sourceChainId: u64 (BE)
[17-24] destinationChainId: u64 (BE)
[25-28] canonicalAssetId: u32 (BE)
[29-36] amount: u64 (BE)
[37-68] sourceNullifierHash: [u8; 32]
[69-100] destinationCommitment: [u8; 32]
[101-132] sourceTxHash: [u8; 32]
[133-140] sourceBlockNumber: u64 (BE)
[141-148] sourceNonce: u64 (BE)
[149-156] deadline: u64 (BE)
[157-164] relayerFee: u64 (BE)
[165-172] signerSetVersion: u64 (BE)
[173-204] memoHash: [u8; 32]
[205-236] reserved: [u8; 32]
```

Total: **237 bytes** (excluding signatures)

---

## 6. Message Validation Rules

### 6.1 Source Contract (bridgeOut)

- `protocolVersion == 1`
- `sourceDomain == this.domainId`
- `destinationDomain != sourceDomain`
- `destinationDomain` is in `allowedDestinationDomains`
- `canonicalAssetId` is supported
- `amount > 0`
- `amount <= perMessageMax`
- `deadline > block.timestamp` (or reasonable future)
- `sourceNullifierHash` not already spent
- ZK proof verifies (including `public_data_hash` binding)

### 6.2 Destination Contract (bridgeMint)

- `protocolVersion == 1`
- `destinationDomain == this.domainId`
- `sourceDomain` is in `allowedSourceDomains`
- Route `(sourceDomain, destinationDomain)` is enabled
- `canonicalAssetId` is supported
- `amount > 0`
- `deadline >= block.timestamp`
- `signerSetVersion == currentSignerSetVersion`
- Threshold signatures verify on `messageHash`
- `messageHash` not in `consumedMessageHashes`
- `amount <= perMessageMax`
- `totalInflowToday[canonicalAssetId] + amount <= perAssetDailyCap`
- `totalRouteInflowToday[route] + amount <= perRouteDailyCap`
- `sourceBlockNumber + finalityConfirmations <= currentBlockNumber`

---

## 7. Example Message

### 7.1 Base Sepolia → Ethereum Sepolia

```json
{
  "protocolVersion": 1,
  "sourceDomain": 33554434,
  "destinationDomain": 33554435,
  "sourceChainId": 84532,
  "destinationChainId": 11155111,
  "canonicalAssetId": 1,
  "amount": 1000000000000000000,
  "sourceNullifierHash": "0x1234...abcd",
  "destinationCommitment": "0x5678...ef01",
  "sourceTxHash": "0x9abc...2345",
  "sourceBlockNumber": 12345678,
  "sourceNonce": 42,
  "deadline": 1770000000,
  "relayerFee": 5000000000000000,
  "signerSetVersion": 1,
  "memoHash": "0x0000...0000",
  "reserved": "0x0000...0000"
}
```

### 7.2 Attestation Hash (hex)

```
messageHash = keccak256(
  "WhitePrivateBridgeAttestationV1",
  0x01,
  0x02000002, // 33554434 BE
  0x02000003, // 33554435 BE
  0x0000000000014a34, // 84532 BE
  0x0000000000aa36a7, // 11155111 BE
  0x00000001, // canonicalAssetId 1 BE
  0x00000000000000000de0b6b3a7640000, // 1 ETH BE
  0x1234...abcd, // nullifier
  0x5678...ef01, // commitment
  0x9abc...2345, // tx hash
  0x0000000000bc614e, // block number BE
  0x000000000000002a, // nonce BE
  0x00000000697d86a0, // deadline BE
  0x0000000000000011c37937e08000, // fee BE
  0x0000000000000001, // signer set version BE
  0x0000...0000 // memo
)
```

---

## 8. Backward Compatibility

The existing 52-byte LayerZero payload format is **deprecated** for v1:

```
// Old format (deprecated)
[0-3]   canonicalAsset: uint32
[4-11]  amount: uint64
[12-43] newCommitment: bytes32
[44-51] sourceNonce: uint64
```

v1 uses the full canonical message format (237 bytes). If LayerZero or another messaging layer is used, the full message is transmitted as the payload.

---

## 9. Future Extensions (v2+)

| Field | v2 Addition |
|-------|-------------|
| `zkLightClientProof` | Inclusion proof that source event exists in source chain header |
| `sourceStateRoot` | Source chain state root at finality block |
| `destinationStealthPubkey` | Optional stealth recipient metadata |
| `complianceTag` | Optional compliance attestation hash |
| `batchRoot` | Merkle root of batched bridge messages |
