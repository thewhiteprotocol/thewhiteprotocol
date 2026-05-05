# PR-010D — Solana Bridge Program v1

**Status:** MERGED  
**Scope:** Add Bridge V1 module to `white-protocol` Solana program with secp256k1 threshold signature verification, message encoding/hashing, and inbound/outbound instruction handlers.  
**Ethereum address recovery bug:** FIXED — was hashing 65-byte SEC1-encoded pubkey (`0x04‖x‖y`), corrected to hash 64-byte uncompressed point (`x‖y`).

---

## 1. Solana Bridge Location

**Main program:** `chains/solana/programs/white-protocol`  
The Bridge V1 logic lives inside the existing `white-protocol` program as a new `bridge` module + 8 instruction handlers.

## 2. white-bridge-solana Decision

**Still stubbed / not modified for v1.**  
`white-bridge-solana` retains its LayerZero OApp stub structure. It was **not** reused for Bridge V1. The Bridge V1 inbound/outbound logic is implemented directly in `white-protocol`. A future PR may wire CPIs from `white-bridge-solana` to `white-protocol` if LayerZero integration is needed.

## 3. Accounts Added

| Account | File | Purpose |
|---------|------|---------|
| `BridgeV1Config` | `state/bridge_v1_config.rs` | Global config: authority, domain_id, signer_set_version, global_paused |
| `BridgeSignerSet` | `state/bridge_signer_set.rs` | Threshold signer set: up to 11 Ethereum addresses, threshold, version |
| `ConsumedBridgeMessage` | `state/bridge_consumed_message.rs` | Replay protection PDA per message hash |
| `FrozenBridgeMessage` | `state/bridge_frozen_message.rs` | Message freeze status PDA |
| `BridgeRouteConfig` | `state/bridge_route_config.rs` | Per-route caps: enabled, paused, max_message_amount, daily inflow/outflow |
| `BridgeAssetConfig` | `state/bridge_asset_config.rs` | Per-asset config: supported, max_message_amount, daily_cap |

## 4. Instructions Added

| Instruction | File | Purpose |
|-------------|------|---------|
| `init_bridge_v1_config` | `bridge_v1_init_config.rs` | Initialize global BridgeV1Config PDA |
| `set_bridge_v1_signer_set` | `bridge_v1_set_signer_set.rs` | Set threshold + sorted signer list |
| `set_bridge_v1_global_pause` | `bridge_v1_set_global_pause.rs` | Toggle global_paused |
| `set_bridge_v1_route` | `bridge_v1_set_route.rs` | Configure route settings + caps |
| `set_bridge_v1_asset` | `bridge_v1_set_asset.rs` | Configure asset support + caps |
| `freeze_bridge_v1_message` | `bridge_v1_freeze_message.rs` | Freeze/unfreeze a specific message hash |
| `init_bridge_v1_out` | `bridge_v1_init_outbox.rs` | Validate + record outbound BridgeOut message |
| `accept_bridge_v1_mint` | `bridge_v1_accept_mint.rs` | Verify threshold sigs + record consumed message for BridgeMint |

## 5. Signature Scheme

- **Message hash:** raw keccak256 of `domainSeparator ‖ encodedMessage` — no EIP-191 prefix
- **Curve:** secp256k1
- **Signature format:** 65-byte `r(32) ‖ s(32) ‖ v(1)` where v ∈ {27, 28}
- **Recovery:** Solana `secp256k1_recover` syscall (uses `libsecp256k1` on non-SBF)
- **Threshold verification:**
  - Signatures must be sorted by recovered Ethereum address (strictly ascending)
  - No duplicate signers
  - Each recovered signer must be present in `BridgeSignerSet`
  - Valid count must be ≥ threshold
  - Max 7 signatures per instruction (compute budget limit)
- **Ethereum address derivation:** `keccak256(x ‖ y)[12..32]` — 64-byte uncompressed point, **no 0x04 prefix**

## 6. Replay Protection

**Implemented:** `ConsumedBridgeMessage` PDA.  
The `accept_bridge_v1_mint` instruction creates a `ConsumedBridgeMessage` account keyed by the message hash. Re-accepting the same message fails with `MessageAlreadyConsumed`.

## 7. Route Caps

**Implemented:** `BridgeRouteConfig` supports:
- `enabled` / `paused` flags
- `max_message_amount` per message
- Daily inflow / outflow tracking with `record_inflow()` / `record_outflow()`

## 8. Asset Caps

**Implemented:** `BridgeAssetConfig` supports:
- `supported` flag
- `max_message_amount` per message
- `daily_cap` with `record_usage()`

## 9. Pause / Freeze

**Implemented:**
- **Global pause:** `BridgeV1Config.global_paused` — halts all bridge operations
- **Route pause:** `BridgeRouteConfig.paused` — halts specific route
- **Message freeze:** `FrozenBridgeMessage` PDA — freezes individual message hash

## 10. BridgeOutbox Implemented

**Yes.** `init_bridge_v1_out` validates the BridgeMessageV1, checks route/asset caps, records outflow, and emits `BridgeOutInitiated` event.

## 11. BridgeInbox Implemented

**Yes (accept_mint).** `accept_bridge_v1_mint` verifies threshold signatures, checks replay protection, validates route/asset config, records inflow, creates `ConsumedBridgeMessage`, and emits `BridgeMintAccepted` event.

## 12. WhiteProtocol Commitment Insertion

**Deferred.** The `accept_bridge_v1_mint` instruction validates the `destination_commitment` field but does **not** yet insert it into the WhiteProtocol Merkle tree. A future PR will add the Merkle-tree insertion CPI or direct state update.

## 13. Tests

### Rust Unit Tests

| Module | Tests | Status |
|--------|-------|--------|
| `bridge/attestation.rs` | 10 | ✅ PASS |
| `bridge/message_v1.rs` | 8 | ✅ PASS |
| All existing tests | 97 | ✅ PASS |
| **Total** | **115** | **✅ ALL PASS** |

### Anchor / TypeScript Tests

**0 added.** No TS integration tests for Bridge V1. Legacy `cu-measure-bridge.ts` still tests old `bridge_withdraw`/`bridge_mint`.

## 14. Commands Run

```bash
cd chains/solana/programs/white-protocol
cargo test --lib          # 115/115 pass
cargo clippy --lib        # 0 errors, 0 warnings
cargo fmt                 # applied
cd chains/solana
anchor build              # SBF build success, .so generated
```

## 15. Files Changed

### New files (white-protocol)

```
chains/solana/programs/white-protocol/src/bridge/mod.rs
chains/solana/programs/white-protocol/src/bridge/attestation.rs
chains/solana/programs/white-protocol/src/bridge/message_v1.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_accept_mint.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_freeze_message.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_init_config.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_init_outbox.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_set_asset.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_set_global_pause.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_set_route.rs
chains/solana/programs/white-protocol/src/instructions/bridge_v1_set_signer_set.rs
chains/solana/programs/white-protocol/src/state/bridge_asset_config.rs
chains/solana/programs/white-protocol/src/state/bridge_config.rs
chains/solana/programs/white-protocol/src/state/bridge_consumed_message.rs
chains/solana/programs/white-protocol/src/state/bridge_frozen_message.rs
chains/solana/programs/white-protocol/src/state/bridge_route_config.rs
chains/solana/programs/white-protocol/src/state/bridge_signer_set.rs
chains/solana/programs/white-protocol/src/state/bridge_v1_config.rs
```

### Modified files (white-protocol)

```
chains/solana/programs/white-protocol/Cargo.toml
chains/solana/programs/white-protocol/src/error.rs
chains/solana/programs/white-protocol/src/events.rs
chains/solana/programs/white-protocol/src/instructions/mod.rs
chains/solana/programs/white-protocol/src/lib.rs
chains/solana/programs/white-protocol/src/state/mod.rs
```

### Modified files (white-bridge-solana — minor)

```
chains/solana/programs/white-bridge-solana/Cargo.toml
chains/solana/programs/white-bridge-solana/src/lib.rs
```

## 16. CU Notes

| Operation | Estimated CU |
|-----------|-------------|
| 1× secp256k1 recover | ~25k–30k CU |
| 7× secp256k1 recover (max) | ~175k–210k CU |
| `accept_bridge_v1_mint` (5-of-7) | ~250k–300k CU total |
| `init_bridge_v1_out` | ~30k–50k CU |

**Limit enforced:** `MAX_SIGNATURES = 7` to stay within Solana's 1.4M CU budget.

## 17. Deferred Items

1. **Merkle tree commitment insertion** in `accept_bridge_v1_mint` — needs `deposit_masp`-style commitment insertion into the WhiteProtocol Merkle tree.
2. **TypeScript / Anchor integration tests** — no end-to-end TS tests for Bridge V1 instructions.
3. **`white-bridge-solana` CPI wiring** — LayerZero OApp stub not connected to Bridge V1.
4. **SBF-target clippy** — not run (target not installed in this environment).
5. **Production signer set rotation** — `set_signer_set` updates version but does not invalidate in-flight messages.
6. **Fee collection** — relayer fee is validated in message but not transferred.

## 18. Report Path

`docs/fixes/PR-010D-solana-bridge-program-v1.md` (this file)

## 19. Next Recommended PR

**PR-010E — Bridge V1 Inbox Commitment Insertion & Integration Tests**

Scope:
- Wire `accept_bridge_v1_mint` to insert `destination_commitment` into the WhiteProtocol Merkle tree
- Add TypeScript/Anchor integration tests for all 8 Bridge V1 instructions
- Add CU measurement tests for threshold signature verification
- Optionally: wire `white-bridge-solana` CPIs to Bridge V1 if LayerZero integration is prioritized
