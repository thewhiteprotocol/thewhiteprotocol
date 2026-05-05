# PR-010F: Bridge V1 Relayer Attestation Service

## Overview

Implements the bridge relayer attestation service that observes `BridgeOutInitiated` events on source chains, waits for finality, signs the `BridgeMessageV1` hash with threshold secp256k1 signers, and submits `acceptBridgeMint` on destination chains.

## Components

### 1. Bridge Message Types (`relayer/src/bridge/types.ts`)

- `BridgeMessageStatus` enum: 9-state state machine
  - `OBSERVED` → `FINALITY_WAIT` → `READY_TO_ATTEST` → `SIGNED` → `SUBMITTED` → `CONFIRMED`
  - Terminal states: `FAILED`, `FROZEN`, `EXPIRED`
- `BridgeMessageState`: Full persisted state with signatures, tx hashes, timestamps
- `BridgeEventObservation`: Event from source adapter
- `BridgeSourceAdapter` / `BridgeDestinationAdapter`: Interface contracts

### 2. State Store (`relayer/src/bridge/state.ts`)

- JSON file-based persistence (`STATE_DIR` env)
- Atomic write-then-rename
- Case-insensitive message hash lookup
- BigInt-safe JSON serialization
- Methods: `get`, `set`, `update`, `has`, `list`, `listByStatus`, `delete`, `clear`

### 3. Signer Service (`relayer/src/bridge/signer.ts`)

- Loads test private keys from `BRIDGE_SIGNER_PRIVATE_KEYS` (comma-separated)
- Signs raw `hashBridgeMessageV1()` with viem `account.sign({ hash })`
- Sorts signatures by recovered Ethereum address ascending (strictly increasing)
- `takeThreshold()`: extracts first N signatures
- `validateSignatureOrder()`: rejects duplicates / unsorted
- `extractRawSignatures()`: returns 65-byte hex strings for contract submission

**Security**: Test keys only. Production MUST use HSM/KMS/MPC.

### 4. EVM Adapter (`relayer/src/bridge/evm-adapter.ts`)

**Source (`EvmSourceAdapter`)**:
- Watches `BridgeOutInitiated` events via viem `getContractEvents`
- Paginated log fetching (100-block lookback on startup)
- `isFinalized()`: polls receipt confirmations against current block

**Destination (`EvmDestinationAdapter`)**:
- `isMessageConsumed()`: view call to `BridgeInbox.isMessageConsumed`
- `submitAcceptBridgeMint()`: writes `acceptBridgeMint(message, signatures, signerSetVersion)`
- Converts `BridgeMessageV1` to viem-compatible struct (bigint for uint64, 0x-prefixed hex for bytes32)

**Message Decoder**:
- `decodeBridgeMessageV1(encoded: Uint8Array)` — round-trips with `encodeBridgeMessageV1()`
- Validates exact 451-byte length

### 5. Solana Adapter (`relayer/src/bridge/solana-adapter.ts`)

**PDA Derivation** (matches Rust program seeds):
- `deriveBridgeV1ConfigPDA()` — seed: `"bridge_v1_config"`
- `deriveBridgeSignerSetPDA(version)` — seed: `"bridge_signer_set" + version_le`
- `deriveConsumedMessagePDA(hash)` — seed: `"consumed_msg" + hash`
- `deriveFrozenMessagePDA(hash)` — seed: `"frozen_msg" + hash`
- `deriveBridgeRoutePDA(src, dst)` — seed: `"bridge_route" + src_le + dst_le`
- `deriveBridgeAssetPDA(assetId)` — seed: `"bridge_asset" + assetId`
- `derivePendingBufferPDA(poolConfig)` — seed: `"pending" + poolConfig`
- `deriveCommitmentIndexPDA(poolConfig, commitment)` — seed: `"commitment" + poolConfig + commitment`

**Instruction Builder**:
- `buildAcceptBridgeV1MintAccounts()` — resolves all required accounts
- `SolanaDestinationAdapter` skeleton (full submission deferred until devnet accounts ready)

### 6. Bridge Relayer Service (`relayer/src/bridge/index.ts`)

Orchestrates the full flow:
1. `processEvent()` — idempotency check (state + on-chain consumed)
2. Decode full message from `encodedMessage` hex
3. Validate destination domain, check expiry
4. Wait for finality via `sourceAdapter.isFinalized()`
5. Sign with threshold via `BridgeSignerService`
6. Submit via `destinationAdapter.submitAcceptBridgeMint()`
7. Update state on success/failure

### 7. Status API (`relayer/src/bridge/status-api.ts`)

Express router mounted on main relayer app:
- `GET /bridge/status` — health, route list, message counts by status
- `GET /bridge/messages/:hash` — single message lookup
- `GET /bridge/messages?status=&limit=&offset=` — paginated list with optional filter
- `GET /bridge/routes` — all configured routes

Wired into `RelayerService` when `STATE_DIR` env is set.

## Tests

All tests in `relayer/src/bridge/__tests__/`:

| Suite | Tests | Status |
|---|---|---|
| `state.test.ts` | 10 | ✅ PASS |
| `signer.test.ts` | 10 | ✅ PASS |
| `evm-adapter.test.ts` | 2 | ✅ PASS |
| `solana-adapter.test.ts` | 9 | ✅ PASS |
| `service.test.ts` | 4 | ✅ PASS |
| **Total** | **35** | **✅ PASS** |

### Key Test Coverage
- State persistence survives re-instantiation
- Signatures sorted ascending, no duplicates
- 2-of-3 and 5-of-7 threshold signing
- Round-trip encode/decode 451-byte messages
- PDA derivation determinism and variation
- Service: new message flow, idempotency, expiry, submission failure

## Configuration

Environment variables:
```bash
# State persistence
STATE_DIR=./data

# Bridge routes (source:dest:signerSetVersion)
BRIDGE_ROUTES=base-sepolia:ethereum-sepolia:1

# Test signer keys (NEVER USE IN PRODUCTION)
BRIDGE_SIGNER_PRIVATE_KEYS=0x...,0x...,0x...
```

## Gas / CU Benchmarks

From PR-010E:

| Chain | 2-of-3 | 5-of-7 |
|---|---|---|
| EVM (`acceptBridgeMint`) | ~1,167,958 gas | ~1,522,042 gas |
| Solana (`accept_bridge_v1_mint`) | ~80k–100k CU | ~200k–250k CU |

## Cross-Language Parity

- Domain separator: raw ASCII `"WHITE_PRIVATE_BRIDGE_MESSAGE_V1"` (not hashed)
- Encoding: 451 bytes big-endian, fixed layout
- Hash: `keccak256(domainSeparator \|\| encodedMessage)`
- Implementation in `packages/core/src/bridge-message.ts` (TypeScript), `BridgeMessageLib.sol` (Solidity), `bridge_message.rs` (Rust)

## Security Notes

- `bridgeCommitments` mapping in `WhiteProtocol.sol` prevents duplicate commitment insertion
- `ConsumedBridgeMessage` PDA on Solana prevents double-spending
- Test signer keys must never be committed to git
- Production signing requires HSM/KMS/MPC

## Deferred Work

- Full Solana destination submission (needs devnet bridge accounts)
- Bridge-specific E2E test script (needs cross-chain deployment)
- Finality configuration per-chain in relayer config file
- Message retry / backoff for `FAILED` states
