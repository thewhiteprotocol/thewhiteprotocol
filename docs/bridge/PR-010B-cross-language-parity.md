# PR-010B: Cross-Language Parity Proof — Bridge Message V1

## Summary

Canonical bridge message encoding, hashing, and validation have been implemented in three languages with **identical keccak256 hash output** for all golden vectors:

| Language | Location | Tests | Status |
|----------|----------|-------|--------|
| **TypeScript** | `packages/core/src/bridge-message.ts` | 31 (26 unit + 5 golden) | ✅ Pass |
| **Solidity** | `chains/evm/contracts/libraries/BridgeMessageLib.sol` | 19 | ✅ Pass |
| **Rust** | `chains/solana/programs/white-bridge-solana/src/bridge_message_v1.rs` | 20 | ✅ Pass |

**Total: 70 tests across 3 languages, all passing.**

---

## Encoding Specification

### Fixed Layout (451 bytes)

| Offset | Size | Field | Type |
|--------|------|-------|------|
| 0 | 2 | protocolVersion | uint16 (BE) |
| 2 | 1 | messageType | uint8 |
| 3 | 4 | sourceDomain | uint32 (BE) |
| 7 | 4 | destinationDomain | uint32 (BE) |
| 11 | 8 | sourceChainId | uint64 (BE) |
| 19 | 8 | destinationChainId | uint64 (BE) |
| 27 | 32 | canonicalAssetId | bytes32 |
| 59 | 32 | sourceLocalAssetId | bytes32 |
| 91 | 32 | destinationLocalAssetId | bytes32 |
| 123 | 16 | amount | uint128 (BE) |
| 139 | 32 | sourceNullifierHash | bytes32 |
| 171 | 32 | destinationCommitment | bytes32 |
| 203 | 32 | sourceRoot | bytes32 |
| 235 | 8 | sourceLeafIndex | uint64 (BE) |
| 243 | 32 | sourceTxHash | bytes32 |
| 275 | 8 | sourceBlockNumber | uint64 (BE) |
| 283 | 8 | sourceFinalityBlock | uint64 (BE) |
| 291 | 8 | nonce | uint64 (BE) |
| 299 | 8 | deadline | uint64 (BE) |
| 307 | 16 | relayerFee | uint128 (BE) |
| 323 | 32 | recipientStealthMetadataHash | bytes32 |
| 355 | 32 | memoHash | bytes32 |
| 387 | 32 | reserved0 | bytes32 |
| 419 | 32 | reserved1 | bytes32 |
| **Total** | **451** | | |

### Hash Algorithm

```
hash = keccak256("WHITE_PRIVATE_BRIDGE_MESSAGE_V1" || encodedMessage)
```

Where:
- Domain separator is the **raw ASCII bytes** (31 bytes), NOT a keccak256 hash of the string
- `||` denotes concatenation
- `encodedMessage` is exactly 451 bytes

---

## Golden Vectors

All three implementations assert exact hash equality against these values:

### Vector 1: Base Sepolia → Ethereum Sepolia (BridgeOut)
```
Hash: 0xb4ac9c8ca75af8eb1ff0b31acf18657abffbbc3322a410194eb7815e4b8da464
```

### Vector 2: BNB Testnet → Polygon Amoy (BridgeOut)
```
Hash: 0xddb2b950bbab4f2593fc988f4a477eeb36d57f4a71508f55febb31acbf58d7f4
```

### Vector 3: Solana Devnet → Base Sepolia (BridgeOut)
```
Hash: 0x8c0c22e9417df1a7c3a570afde1679472a406d67f8cf4a043cd445ce67eed344
```

### Vector 4: Ethereum Sepolia → Base Sepolia (BridgeMint)
```
Hash: 0xbfc85db07abe8b9e72838726899619013a18e2580f3d1ee3e688323a41e406e7
```

---

## Bugs Found & Fixed During Parity Work

### 1. TypeScript `uint128ToBytes` was broken
**Issue:** The function had a double-loop bug where `val` was never updated in the first loop, causing all bytes to be written with the low byte value. The second loop then overwrote using a partially-shifted value.

**Fix:** Replaced with a single correct loop:
```typescript
function uint128ToBytes(value: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  let v = BigInt.asUintN(128, value);
  for (let i = 15; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v = v >> 8n;
  }
  return buf;
}
```

### 2. Solidity `DOMAIN_SEPARATOR` was hashed prematurely
**Issue:** `DOMAIN_SEPARATOR` was defined as `keccak256(bytes("WHITE_PRIVATE_BRIDGE_MESSAGE_V1"))`, so the hash computation became `keccak256(keccak256(string) || encoded)` instead of `keccak256(string || encoded)`.

**Fix:** Changed to raw bytes constant:
```solidity
bytes public constant DOMAIN_SEPARATOR = bytes("WHITE_PRIVATE_BRIDGE_MESSAGE_V1");
```

---

## Running the Tests

### TypeScript
```bash
cd packages/core && npm test -- --run
```

### Solidity
```bash
cd chains/evm && forge test --match-path test/BridgeMessageLib.t.sol -vvv
```

### Rust
```bash
cd chains/solana && cargo test -p white-bridge-solana -- bridge_message_v1
```

---

## Files Added/Modified

| File | Action | Description |
|------|--------|-------------|
| `packages/core/src/bridge-message.ts` | Modified | Fixed `uint128ToBytes` bug |
| `packages/core/src/__tests__/bridge-message.test.ts` | Existing | 26 unit tests |
| `packages/core/src/__tests__/bridge-message-golden.test.ts` | **Added** | 5 golden vector parity tests |
| `packages/core/src/__tests__/bridge-message-golden.json` | **Added** | Shared golden vector data |
| `packages/core/src/__tests__/generate-golden-hashes.ts` | **Added** | Hash generation utility |
| `chains/evm/contracts/libraries/BridgeMessageLib.sol` | **Added** | Solidity library (451-byte encoding) |
| `chains/evm/test/BridgeMessageLib.t.sol` | **Added** | 19 Foundry tests |
| `chains/solana/programs/white-bridge-solana/src/bridge_message_v1.rs` | **Added** | Rust module (451-byte encoding) |
| `chains/solana/programs/white-bridge-solana/src/lib.rs` | Modified | Added `pub mod bridge_message_v1;` |
| `chains/solana/programs/white-bridge-solana/Cargo.toml` | Modified | Added `sha3` and `hex` deps |
| `docs/bridge/PR-010B-cross-language-parity.md` | **Added** | This document |
