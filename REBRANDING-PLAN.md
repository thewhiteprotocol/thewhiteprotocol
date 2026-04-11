# Rebranding Plan: pSOL v2 → The White Protocol

## Overview
This document outlines the complete rebranding from **pSOL v2** (Privacy SOL) to **The White Protocol** - a more memorable, brandable name for a privacy-focused DeFi protocol.

---

## Naming Conventions

| Component | Old Name | New Name |
|-----------|----------|----------|
| Protocol | pSOL v2 | The White Protocol |
| Program Package | `psol-privacy-v2` | `white-protocol` |
| Program Module | `psol_privacy_v2` | `white_protocol` |
| SDK Package | `@psol/sdk` | `@whiteprotocol/sdk` |
| Relayer Package | `@psol/relayer` | `@whiteprotocol/relayer` |
| Anchor Program ID | `psol_privacy_v2` | `white_protocol` |
| Client Class | `PsolV2Client` | `WhiteProtocolClient` |
| Error Type | `PrivacyErrorV2` | `WhiteProtocolError` |

---

## Phase 1: Rust Program Changes

### 1.1 Directory Structure
```
programs/
  psol-privacy-v2/ → white-protocol/
```

### 1.2 Cargo.toml Changes
**File:** `programs/white-protocol/Cargo.toml`

```toml
[package]
name = "white-protocol"
version = "2.0.0"
description = "The White Protocol - Multi-Asset Shielded Pool (MASP) on Solana"

[lib]
name = "white_protocol"
crate-type = ["cdylib", "lib"]
```

### 1.3 State Struct Renames
**File:** `programs/white-protocol/src/state/`

| Old Name | New Name | PDA Seeds |
|----------|----------|-----------|
| `PoolConfigV2` | `PoolConfig` | `pool_v2` → `white_pool` |
| `MerkleTreeV2` | `MerkleTree` | `merkle_tree_v2` → `merkle_tree` |
| `AssetVault` | `AssetVault` | `vault_v2` → `vault` |
| `SpentNullifierV2` | `SpentNullifier` | `nullifier_v2` → `nullifier` |
| `VerificationKeyAccountV2` | `VerificationKeyAccount` | (same) |
| `RelayerRegistry` | `RelayerRegistry` | (same) |
| `ComplianceConfig` | `ComplianceConfig` | (same) |
| `YieldRegistry` | `YieldRegistry` | (same) |
| `PendingDepositsBuffer` | `PendingDepositsBuffer` | `pending_deposits` → `pending` |

### 1.4 Error Type Rename
**File:** `programs/white-protocol/src/error.rs`

```rust
// Old
pub enum PrivacyErrorV2 { ... }

// New
pub enum WhiteProtocolError { ... }
```

### 1.5 Program Module Name
**File:** `programs/white-protocol/src/lib.rs`

```rust
// Old
#[program]
pub mod psol_privacy_v2 { ... }

// New
#[program]
pub mod white_protocol { ... }
```

### 1.6 Seed Constant Updates
**Files:** All state files with PDA seeds

```rust
// Old
pub const SEED_PREFIX: &'static [u8] = b"pool_v2";
pub const SEED_PREFIX: &'static [u8] = b"merkle_tree_v2";
pub const SEED_PREFIX: &'static [u8] = b"vault_v2";
pub const SEED_PREFIX: &'static [u8] = b"nullifier_v2";

// New
pub const SEED_PREFIX: &'static [u8] = b"white_pool";
pub const SEED_PREFIX: &'static [u8] = b"merkle_tree";
pub const SEED_PREFIX: &'static [u8] = b"vault";
pub const SEED_PREFIX: &'static [u8] = b"nullifier";
```

### 1.7 Comment Updates
- Update all module-level documentation comments
- Update inline comments referencing "pSOL" or "psol"

---

## Phase 2: Anchor Configuration

### 2.1 Anchor.toml Updates
**File:** `Anchor.toml`

```toml
[programs.devnet]
white_protocol = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"

[programs.localnet]
white_protocol = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"

[programs.mainnet]
white_protocol = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"
```

### 2.2 Workspace Cargo.toml
**File:** `Cargo.toml`

```toml
[workspace]
members = ["programs/white-protocol"]
```

---

## Phase 3: SDK Changes

### 3.1 Package.json Updates
**File:** `sdk/package.json`

```json
{
  "name": "@whiteprotocol/sdk",
  "version": "2.0.0",
  "description": "The White Protocol SDK - Multi-Asset Shielded Pool on Solana",
  "author": "White Protocol Team",
  "repository": {
    "type": "git",
    "url": "https://github.com/whiteprotocol/white-protocol"
  },
  "keywords": [
    "solana",
    "privacy",
    "masp",
    "shielded",
    "zk-proofs",
    "white-protocol",
    "defi"
  ]
}
```

### 3.2 Client Class Rename
**File:** `sdk/src/client.ts`

```typescript
// Old
export class PsolV2Client { ... }
export function createPsolClient(...) { ... }

// New
export class WhiteProtocolClient { ... }
export function createWhiteProtocolClient(...) { ... }
```

### 3.3 PDA Seed Updates
**File:** `sdk/src/pda.ts`

```typescript
// Old
export const POOL_V2_SEED = Buffer.from('pool_v2');
export const MERKLE_TREE_V2_SEED = Buffer.from('merkle_tree_v2');
export const VAULT_V2_SEED = Buffer.from('vault_v2');
export const NULLIFIER_V2_SEED = Buffer.from('nullifier_v2');

// New
export const POOL_SEED = Buffer.from('white_pool');
export const MERKLE_TREE_SEED = Buffer.from('merkle_tree');
export const VAULT_SEED = Buffer.from('vault');
export const NULLIFIER_SEED = Buffer.from('nullifier');
```

### 3.4 Type Renames
**File:** `sdk/src/types.ts`

```typescript
// Old (if any pSOL-specific types)
export interface PsolV2ClientOptions { ... }

// New
export interface WhiteProtocolClientOptions { ... }
```

### 3.5 IDL File Rename
**File:** `sdk/src/idl/white_protocol.json`

```
sdk/src/idl/psol_privacy_v2.json → sdk/src/idl/white_protocol.json
```

### 3.6 SDK Index Exports
**File:** `sdk/src/index.ts`

```typescript
// Old
export const SDK_VERSION = '2.0.0';
export const IS_PRODUCTION_READY = false;
export const SDK_STATUS = "alpha";

// New
export const SDK_VERSION = '2.0.0';
export const IS_PRODUCTION_READY = false;
export const SDK_STATUS = "alpha";
export const PROTOCOL_NAME = "The White Protocol";
```

---

## Phase 4: Relayer Changes

### 4.1 Package.json Updates
**File:** `relayer/package.json`

```json
{
  "name": "@whiteprotocol/relayer",
  "version": "2.0.0",
  "description": "The White Protocol Relayer Service"
}
```

### 4.2 Service Name Updates
**File:** `relayer/src/index.ts`

```typescript
// Update all log messages and comments
// Old: "pSOL v2 Relayer Service"
// New: "The White Protocol Relayer Service"
```

### 4.3 Environment Variables
**File:** `relayer/.env.example`

```bash
# Old naming pattern
PSOL_PROGRAM_ID=...
PSOL_POOL_CONFIG=...

# New naming pattern
WHITE_PROTOCOL_PROGRAM_ID=...
WHITE_PROTOCOL_POOL_CONFIG=...
```

---

## Phase 5: Root Package.json

**File:** `package.json`

```json
{
  "name": "white-protocol",
  "version": "2.0.0",
  "description": "The White Protocol - Privacy-preserving Multi-Asset Shielded Pool on Solana",
  "workspaces": [
    "sdk",
    "relayer"
  ],
  "repository": {
    "type": "git",
    "url": "https://github.com/whiteprotocol/white-protocol"
  }
}
```

---

## Phase 6: Documentation Updates

### 6.1 README.md
Complete rewrite with new branding:
- Title: "The White Protocol"
- Remove all "pSOL" references
- Update architecture diagrams
- Update API endpoints
- Update deployment addresses

### 6.2 Code Comments
Search and replace in all source files:
- `pSOL` → `The White Protocol` or `White Protocol`
- `psol` → `white` or `whiteprotocol`
- `Psol` → `White`

---

## Phase 7: Scripts Updates

### 7.1 Import Updates
All scripts in `scripts/` directory need:
- Updated import paths
- Updated PDA derivation calls
- Updated client class instantiation
- Updated IDL references

### 7.2 Key Script Files to Update
- `scripts/init-pool-*.ts`
- `scripts/register-*.ts`
- `scripts/upload-*.ts`
- `scripts/sequencer*.ts`
- `scripts/check-*.ts`

---

## Phase 8: Test Files

### 8.1 Test Updates
All test files in `tests/` directory need:
- Updated imports
- Updated client instantiation
- Updated PDA seeds

---

## Phase 9: Circuit Files

### 9.1 Comment Updates
While circuit logic stays the same, update comments:
**Files:** `circuits/**/*.circom`

```circom
// Old: "pSOL v2 Deposit Circuit"
// New: "The White Protocol Deposit Circuit"
```

---

## Phase 10: GitHub & Repository

### 10.1 Repository Rename
- Rename GitHub repository to `whiteprotocol/white-protocol`
- Update all remote URLs

### 10.2 New Program Deployment (Optional)
If deploying as a new program:
- Generate new program keypair: `solana-keygen new -o white-protocol-keypair.json`
- Update `Anchor.toml` with new program ID
- Update `sdk/src/pda.ts` default program ID

---

## File Change Summary

### Critical Path (Must Change)
| File | Changes |
|------|---------|
| `Cargo.toml` | Program name in workspace |
| `programs/*/Cargo.toml` | Package name, lib name |
| `programs/*/src/lib.rs` | Program module name |
| `programs/*/src/error.rs` | Error enum name |
| `programs/*/src/state/*.rs` | PDA seeds, struct names |
| `Anchor.toml` | Program ID mappings |
| `sdk/package.json` | Package name |
| `sdk/src/pda.ts` | Seed constants |
| `sdk/src/client.ts` | Class name |
| `sdk/src/idl/*.json` | File rename, content |
| `relayer/package.json` | Package name |
| `package.json` | Project name |

### Secondary (Should Change)
| File | Changes |
|------|---------|
| `README.md` | Complete rebrand |
| `docs/*.md` | All documentation |
| `scripts/*.ts` | Imports, class names |
| `tests/*.ts` | Imports, class names |
| `circuits/**/*.circom` | Comments |

### Tertiary (Nice to Have)
| File | Changes |
|------|---------|
| `.env.example` | Environment variable names |
| `tsconfig.json` | Comments |
| `jest.config.js` | Comments |

---

## Migration Strategy

### Option A: In-Place Rename (Breaking Change)
1. Make all changes in single PR
2. Update all internal references
3. Existing deployed programs keep old PDAs/seeds
4. New deployments use new seeds

### Option B: Fork & Maintain (Recommended)
1. Create new branch `rebrand/white-protocol`
2. Make all renaming changes
3. Deploy new program with new ID
4. Maintain pSOL v2 for existing users
5. Gradually migrate liquidity

### Option C: Gradual Migration
1. Keep `psol-privacy-v2` program as-is
2. Create new `white-protocol` program
3. SDK exports both clients
4. Add migration instructions for users

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests pass with new names
- [ ] IDL generated correctly
- [ ] SDK builds successfully
- [ ] Relayer starts without errors

### Deployment
- [ ] Deploy new program (if new program ID)
- [ ] Initialize pool with new PDA seeds
- [ ] Upload verification keys
- [ ] Register assets
- [ ] Register relayer

### Post-Deployment
- [ ] Update documentation site
- [ ] Update API documentation
- [ ] Update frontend (if applicable)
- [ ] Announce migration path

---

## Backwards Compatibility Notes

**Important:** Changing PDA seeds (`pool_v2` → `white_pool`, etc.) means:
- Existing deployed programs will have different PDA addresses
- Users cannot use old SDK with new program
- New SDK cannot interact with old program

**Recommendation:** If keeping the same program ID, maintain old seed constants for backwards compatibility, or deploy as entirely new program.

---

## Timeline Estimate

| Phase | Estimated Time |
|-------|----------------|
| Phase 1: Rust Program | 2-3 hours |
| Phase 2: Anchor Config | 30 minutes |
| Phase 3: SDK | 2-3 hours |
| Phase 4: Relayer | 1 hour |
| Phase 5-6: Docs | 2-3 hours |
| Phase 7-8: Scripts & Tests | 2-3 hours |
| Testing & Bug Fixes | 2-4 hours |
| **Total** | **12-18 hours** |

---

## Next Steps

1. **Choose migration strategy** (A, B, or C)
2. **Create feature branch** for rebranding
3. **Execute Phase 1-5** (core changes)
4. **Run full test suite**
5. **Deploy to devnet** for testing
6. **Update documentation**
7. **Merge and tag release**

---

*Document Version: 1.0*
*Created for: pSOL v2 → The White Protocol Rebrand*
