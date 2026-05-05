# PR-010C: EVM BridgeInbox/Outbox v1

**Status:** Complete  
**Date:** 2026-05-04  
**Scope:** EVM contracts only — no Solana, no relayer runtime, no circuits, no deployment

---

## 1. Summary

Implemented the EVM-side BridgeInbox and BridgeOutbox v1 contracts with threshold secp256k1 attestations, replay protection, route/asset caps, and pause/freeze controls. Reuses `BridgeMessageLib` from PR-010B. Does not yet integrate with `WhiteProtocol.bridgeMint` — that is deferred to PR-010D/010E.

---

## 2. Existing Bridge Code Decision

| Contract | Decision | Rationale |
|----------|----------|-----------|
| `WhiteBridge.sol` | **Keep as legacy/deprecated** | LayerZero OApp with 52-byte compact format. Still has tests and works. Not deleted to avoid breaking existing deployments. |
| `BridgeAssetRegistry.sol` | **Keep as-is** | Canonical↔local asset mapping is still valid. New inbox/outbox use `bytes32 canonicalAssetId` from `BridgeMessageLib` directly. |
| `WhiteProtocol.sol` | **No changes** | `bridgeWithdraw`/`bridgeMint` hooks unchanged. New inbox/outbox do not call them yet. |

New contracts (`BridgeInbox.sol`, `BridgeOutbox.sol`) are standalone and do not depend on `WhiteBridge.sol`. They can coexist during migration.

---

## 3. Contracts/Libraries Added

| File | Description |
|------|-------------|
| `contracts/BridgeInbox.sol` | Destination-chain inbox: threshold sig verification, replay protection, caps, pause/freeze |
| `contracts/BridgeOutbox.sol` | Source-chain outbox: message validation, nonce tracking, route/asset checks, caps |
| `contracts/libraries/BridgeAttestationLib.sol` | Threshold ECDSA signature verification library |
| `contracts/interfaces/IBridgeInbox.sol` | Inbox interface |
| `contracts/interfaces/IBridgeOutbox.sol` | Outbox interface |

---

## 4. Signer Set Model

- Admin-managed signer sets with monotonically increasing `signerSetVersion`
- `SignerSet` struct: `address[] signers`, `uint256 threshold`, `uint256 version`
- `updateSignerSet(signers, threshold)` — owner only, increments version
- Validation rules (enforced by `BridgeAttestationLib.validateSignerSet`):
  - `threshold > 0`
  - `threshold <= signer count`
  - No zero addresses
  - No duplicate signers

---

## 5. Signature Scheme

- **Raw message hash** (no EIP-191 prefix) for cross-chain compatibility with Solana
- Hash input: `BridgeMessageLib.hashMessage(message)` = `keccak256("WHITE_PRIVATE_BRIDGE_MESSAGE_V1" || encodedMessage)`
- Signatures: 65-byte ECDSA `(r, s, v)`
- Verification uses OpenZeppelin `ECDSA.recover`
- **Sorted signatures required**: signatures must be ordered by recovered signer address ascending to prevent duplicate-signer attacks

---

## 6. Replay Protection

### BridgeInbox (destination)
- `consumedMessageHashes[bytes32] → bool` — mandatory, rejects duplicate message hashes
- `consumedMessageHashes` is checked BEFORE signature verification to save gas on replays

### BridgeOutbox (source)
- `outboundMessageHashRecorded[bytes32] → bool` — rejects duplicate outbound messages
- `outboundNonce[uint32 destinationDomain] → uint64` — monotonic per-destination nonce

---

## 7. Route/Asset Caps

### BridgeInbox
| Cap | Type | Behavior |
|-----|------|----------|
| `maxMessageAmount[asset]` | uint128 | Rejects single messages above limit |
| `dailyInflowCap[asset]` | uint128 | Rolling daily window (`block.timestamp / 1 days`) |
| `globalDailyCap` | uint128 | Total daily inflow across all assets |
| `inflowCap[asset]` | uint128 | Cumulative total cap (non-daily, v1 simplification) |

### BridgeOutbox
| Cap | Type | Behavior |
|-----|------|----------|
| `maxMessageAmount[asset]` | uint128 | Rejects single messages above limit |
| `outflowCap[asset]` | uint128 | Rolling daily window |
| `dailyOutflowCap[asset]` | uint128 | Configurable but same slot semantics |

---

## 8. Pause/Freeze Model

### Global Controls
- `globalPaused` — stops ALL bridge activity

### Route Controls
- `isRoutePaused[src][dst]` — stops specific route

### Message Controls
- `freezeMessage(bytes32 messageHash)` — permanently blocks a specific message hash until `unfreezeMessage`
- Frozen messages are rejected at `acceptBridgeMint` with `MessageIsFrozen`

All pause/freeze functions are **owner-only** in v1. Future PRs may add watcher/governance roles.

---

## 9. BridgeOutbox Behavior

`initBridgeOut(BridgeMessageV1 message)`:
1. Check `!globalPaused`
2. Check `message.sourceDomain == localDomain`
3. Check `message.destinationDomain != sourceDomain`
4. Check `isRouteEnabled[destinationDomain]`
5. Check `!isRoutePaused[sourceDomain][destinationDomain]`
6. Check `isAssetSupported[canonicalAssetId]`
7. Check `message.amount > 0`
8. Check `message.deadline >= block.timestamp`
9. Check `!outboundMessageHashRecorded[messageHash]` → record it
10. Check `message.nonce == outboundNonce[dst] + 1` → increment
11. Check `message.amount <= maxMessageAmount`
12. Check daily outflow cap
13. Emit `BridgeOutInitiated(messageHash, ...)`

---

## 10. BridgeInbox Behavior

`acceptBridgeMint(BridgeMessageV1 message, bytes[] signatures, uint256 signerSetVersion)`:
1. Check `!globalPaused`
2. Check `message.destinationDomain == localDomain`
3. Check `message.sourceDomain != destinationDomain`
4. Check `isRouteEnabled[sourceDomain]`
5. Check `!isRoutePaused[sourceDomain][destinationDomain]`
6. Check `isAssetSupported[canonicalAssetId]`
7. Check `message.amount > 0`
8. Check `message.deadline >= block.timestamp`
9. Compute `messageHash = BridgeMessageLib.hashMessage(message)`
10. Check `!consumedMessageHashes[messageHash]`
11. Check `!frozenMessages[messageHash]`
12. Check `signerSetVersion == currentSignerSetVersion`
13. Verify threshold signatures via `BridgeAttestationLib.verifyThresholdSignatures`
14. Check `message.amount <= maxMessageAmount`
15. Check daily inflow cap (asset + global)
16. Mark `consumedMessageHashes[messageHash] = true`
17. Emit `BridgeMintAccepted(messageHash, destinationCommitment, canonicalAssetId, amount, nonce)`

---

## 11. What Is Intentionally Deferred

| Feature | Deferred To | Reason |
|---------|-------------|--------|
| WhiteProtocol.commitment insertion | PR-010D/010E | Inbox emits `BridgeMintAccepted`; separate minter reads event and inserts |
| Source proof verification | PR-010D | Outbox records message; ZK proof is verified in `WhiteProtocol.bridgeWithdraw` |
| Timelock on signer set updates | Future governance | Admin-only for v1 testnet |
| Watcher freeze (permissionless) | PR-010I | Owner-only freeze in v1 |
| Challenge window queue | PR-010I | Immediate acceptance in v1 |
| Bonded slashing | v2 | Not in v1 scope |
| Solana bridge program | PR-010D | Separate PR |
| Relayer bridge service | PR-010E | Separate PR |
| E2E bridge test | PR-010F | Needs relayer + deployed contracts |

---

## 12. Tests Added

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `test/BridgeAttestation.t.sol` | 14 | Threshold sigs: 2-of-3, 5-of-7, duplicate signer, unknown signer, invalid sig, wrong hash, unsorted, threshold > signers, zero signer, duplicate in set, empty set, zero threshold |
| `test/BridgeOutbox.t.sol` | 17 | Valid message, wrong sourceDomain, sameDomain, disabled route, nonce increment, wrong nonce, zero amount, unsupported asset, max amount exceeded, outflow cap exceeded, expired deadline, duplicate hash, global pause, route pause, enable/disable route, non-owner revert, hash recording |
| `test/BridgeInbox.t.sol` | 24 | Valid message + sigs, wrong destination, sameDomain, unsupported route, route paused, global paused, frozen message, duplicate hash, expired deadline, max amount exceeded, daily cap exceeded, global daily cap exceeded, wrong signerSetVersion, insufficient sigs, invalid signer, unsorted sigs, wrong hash, freeze/unfreeze, non-owner freeze, zero amount, unsupported asset, signer set update, old signer set rejected, 5-of-7 threshold |

**Total new tests: 55**

---

## 13. Full EVM Test Results

```bash
cd chains/evm && forge test
```

**Result: 144 tests passed, 0 failed, 0 skipped**

Includes:
- 19 `BridgeMessageLib.t.sol` (PR-010B)
- 14 `BridgeAttestation.t.sol`
- 17 `BridgeOutbox.t.sol`
- 24 `BridgeInbox.t.sol`
- 11 `WhiteBridge.t.sol` (legacy)
- 7 `WhiteProtocolBridgeHooks.t.sol`
- 4 `BridgeAssetRegistry.t.sol`
- 48 `WhiteProtocol.t.sol` + other existing tests

---

## 14. Commands Run

```bash
# Build
cd chains/evm && forge build

# New bridge tests
cd chains/evm && forge test --match-contract "BridgeAttestationTest|BridgeOutboxTest|BridgeInboxTest"

# Full EVM suite
cd chains/evm && forge test
```

---

## 15. Remaining Bridge Blockers

1. **Solana bridge program** (PR-010D) — signer set PDAs, consumed message PDAs, secp256k1 verification
2. **Relayer bridge service** (PR-010E) — event watcher, attestation builder, signature aggregator
3. **WhiteProtocol integration** — inbox needs to actually call `bridgeMint` after accepting message
4. **Deployment + E2E** (PR-010F) — deploy contracts, configure signer set, run Base↔Ethereum test

---

## 16. Next Recommended PR

**PR-010D: Solana Bridge Program v1**
- Implement `SignerSet` PDA, `ConsumedMessage` PDA, `RouteConfig` PDA
- Add `secp256k1_recover` threshold verification
- Add `bridge_mint` and `bridge_out` instructions with CPIs into `white_protocol`
- Mirror the EVM cap/pause/freeze model in Anchor

---

## 17. Files Changed

**Added:**
- `chains/evm/contracts/BridgeInbox.sol`
- `chains/evm/contracts/BridgeOutbox.sol`
- `chains/evm/contracts/libraries/BridgeAttestationLib.sol`
- `chains/evm/contracts/interfaces/IBridgeInbox.sol`
- `chains/evm/contracts/interfaces/IBridgeOutbox.sol`
- `chains/evm/test/BridgeAttestation.t.sol`
- `chains/evm/test/BridgeOutbox.t.sol`
- `chains/evm/test/BridgeInbox.t.sol`
- `docs/fixes/PR-010C-evm-bridge-inbox-outbox.md`

**Modified:**
- `chains/evm/contracts/libraries/BridgeMessageLib.sol` — no layout changes, only `DOMAIN_SEPARATOR` fix from PR-010B

**Not changed:**
- `chains/evm/contracts/bridge/WhiteBridge.sol` (legacy, preserved)
- `chains/evm/contracts/WhiteProtocol.sol`
- `chains/solana/**`
- `relayer/**`
- `circuits/**`
