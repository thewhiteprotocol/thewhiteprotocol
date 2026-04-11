# The White Protocol - Code Changes Reference

Quick reference for the most common code transformations.

---

## Rust Program Changes

### 1. Cargo.toml
```toml
# BEFORE
[package]
name = "psol-privacy-v2"

[lib]
name = "psol_privacy_v2"

# AFTER
[package]
name = "white-protocol"

[lib]
name = "white_protocol"
```

### 2. lib.rs - Program Module
```rust
// BEFORE
#[program]
pub mod psol_privacy_v2 {
    use super::*;
    // ...
}

declare_id!("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

// AFTER
#[program]
pub mod white_protocol {
    use super::*;
    // ...
}

declare_id!("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"); // Same or new
```

### 3. error.rs
```rust
// BEFORE
#[error_code]
pub enum PrivacyErrorV2 {
    #[msg("Pool is paused")]
    PoolPaused,
    // ...
}

// AFTER
#[error_code]
pub enum WhiteProtocolError {
    #[msg("Pool is paused")]
    PoolPaused,
    // ...
}
```

### 4. State - PDA Seeds
```rust
// BEFORE (pool_config.rs)
pub const SEED_PREFIX: &'static [u8] = b"pool_v2";

// AFTER
pub const SEED_PREFIX: &'static [u8] = b"white_pool";
```

```rust
// BEFORE (merkle_tree.rs)
pub const SEED_PREFIX: &'static [u8] = b"merkle_tree_v2";

// AFTER
pub const SEED_PREFIX: &'static [u8] = b"merkle_tree";
```

```rust
// BEFORE (asset_vault.rs)
pub const SEED_PREFIX: &'static [u8] = b"vault_v2";

// AFTER
pub const SEED_PREFIX: &'static [u8] = b"vault";
```

```rust
// BEFORE (spent_nullifier.rs)
pub const SEED_PREFIX: &'static [u8] = b"nullifier_v2";

// AFTER
pub const SEED_PREFIX: &'static [u8] = b"nullifier";
```

### 5. State - Struct Names
```rust
// BEFORE
#[account]
pub struct PoolConfigV2 { ... }

#[account]
pub struct MerkleTreeV2 { ... }

#[account]
pub struct SpentNullifierV2 { ... }

#[account]
pub struct VerificationKeyAccountV2 { ... }

// AFTER
#[account]
pub struct PoolConfig { ... }

#[account]
pub struct MerkleTree { ... }

#[account]
pub struct SpentNullifier { ... }

#[account]
pub struct VerificationKeyAccount { ... }
```

### 6. State - mod.rs Exports
```rust
// BEFORE
pub use pool_config::PoolConfigV2;
pub use merkle_tree::MerkleTreeV2;
pub use spent_nullifier::SpentNullifierV2;
pub use verification_key::VerificationKeyAccountV2;

// AFTER
pub use pool_config::PoolConfig;
pub use merkle_tree::MerkleTree;
pub use spent_nullifier::SpentNullifier;
pub use verification_key::VerificationKeyAccount;
```

---

## TypeScript SDK Changes

### 1. package.json
```json
// BEFORE
{
  "name": "@psol/sdk",
  "description": "Complete TypeScript SDK for pSOL v2...",
  "author": "pSOL Team",
  "repository": {
    "url": "https://github.com/psol-protocol/psol-v2-sdk"
  },
  "keywords": ["psol", "privacy", ...]
}

// AFTER
{
  "name": "@whiteprotocol/sdk",
  "description": "The White Protocol SDK - Privacy-preserving MASP on Solana",
  "author": "White Protocol Team",
  "repository": {
    "url": "https://github.com/whiteprotocol/white-protocol"
  },
  "keywords": ["white-protocol", "privacy", ...]
}
```

### 2. client.ts
```typescript
// BEFORE
export class PsolV2Client {
  constructor(options: PsolV2ClientOptions) { ... }
}

export function createPsolClient(
  provider: AnchorProvider,
  idl: any,
  programId?: PublicKey
): PsolV2Client { ... }

export interface PsolV2ClientOptions { ... }

// AFTER
export class WhiteProtocolClient {
  constructor(options: WhiteProtocolClientOptions) { ... }
}

export function createWhiteProtocolClient(
  provider: AnchorProvider,
  idl: any,
  programId?: PublicKey
): WhiteProtocolClient { ... }

export interface WhiteProtocolClientOptions { ... }
```

### 3. pda.ts
```typescript
// BEFORE
export const POOL_V2_SEED = Buffer.from('pool_v2');
export const MERKLE_TREE_V2_SEED = Buffer.from('merkle_tree_v2');
export const VAULT_V2_SEED = Buffer.from('vault_v2');
export const NULLIFIER_V2_SEED = Buffer.from('nullifier_v2');

export function findPoolConfigPda(...) { ... }

// AFTER
export const POOL_SEED = Buffer.from('white_pool');
export const MERKLE_TREE_SEED = Buffer.from('merkle_tree');
export const VAULT_SEED = Buffer.from('vault');
export const NULLIFIER_SEED = Buffer.from('nullifier');

// Function names can stay the same or be simplified
export function findPoolConfigPda(...) { ... }
```

### 4. IDL Import
```typescript
// BEFORE
import idl from './idl/psol_privacy_v2.json';

// AFTER
import idl from './idl/white_protocol.json';
```

### 5. index.ts
```typescript
// BEFORE
export const SDK_VERSION = '2.0.0';
export const IS_PRODUCTION_READY = false;
export const SDK_STATUS = "alpha";

// AFTER
export const SDK_VERSION = '2.0.0';
export const IS_PRODUCTION_READY = false;
export const SDK_STATUS = "alpha";
export const PROTOCOL_NAME = "The White Protocol";
export const PROTOCOL_VERSION = "2.0.0";
```

---

## Anchor.toml Changes

```toml
# BEFORE
[programs.devnet]
psol_privacy_v2 = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"

[programs.localnet]
psol_privacy_v2 = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"

[programs.mainnet]
psol_privacy_v2 = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"

# AFTER
[programs.devnet]
white_protocol = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"

[programs.localnet]
white_protocol = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"

[programs.mainnet]
white_protocol = "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"
```

---

## Root package.json

```json
// BEFORE
{
  "name": "psol-v2-complete",
  "version": "2.0.0",
  "description": "pSOL v2 Multi-Asset Shielded Pool - Complete Package",
  "repository": {
    "type": "git",
    "url": "https://github.com/psol-protocol/psol-v2"
  }
}

// AFTER
{
  "name": "white-protocol",
  "version": "2.0.0",
  "description": "The White Protocol - Privacy-preserving Multi-Asset Shielded Pool on Solana",
  "repository": {
    "type": "git",
    "url": "https://github.com/whiteprotocol/white-protocol"
  }
}
```

---

## Relayer Changes

### package.json
```json
// BEFORE
{
  "name": "@psol/relayer",
  "description": "pSOL v2 Relayer Service"
}

// AFTER
{
  "name": "@whiteprotocol/relayer",
  "description": "The White Protocol Relayer Service"
}
```

### index.ts - Service Name
```typescript
// BEFORE
console.log("pSOL v2 Relayer Service Started");
console.log("========================================");

// AFTER
console.log("The White Protocol Relayer Service Started");
console.log("========================================");
```

### .env.example
```bash
# BEFORE
PSOL_PROGRAM_ID=BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb
PSOL_POOL_CONFIG=uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc

# AFTER
WHITE_PROTOCOL_PROGRAM_ID=BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb
WHITE_PROTOCOL_POOL_CONFIG=uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc
```

---

## Script Migration Pattern

Most scripts follow this pattern:

```typescript
// BEFORE
import { PsolV2Client, createPsolClient } from '../sdk/src';
import { findPoolConfigPda, PROGRAM_ID } from '../sdk/src/pda';

const client = createPsolClient(provider, idl, PROGRAM_ID);

// AFTER
import { WhiteProtocolClient, createWhiteProtocolClient } from '../sdk/src';
import { findPoolConfigPda, PROGRAM_ID } from '../sdk/src/pda';

const client = createWhiteProtocolClient(provider, idl, PROGRAM_ID);
```

---

## Search & Replace Commands

### Global String Replacements (be careful!)

```bash
# In Rust files
find programs -name "*.rs" -exec sed -i 's/PrivacyErrorV2/WhiteProtocolError/g' {} \;
find programs -name "*.rs" -exec sed -i 's/PoolConfigV2/PoolConfig/g' {} \;
find programs -name "*.rs" -exec sed -i 's/MerkleTreeV2/MerkleTree/g' {} \;
find programs -name "*.rs" -exec sed -i 's/SpentNullifierV2/SpentNullifier/g' {} \;
find programs -name "*.rs" -exec sed -i 's/VerificationKeyAccountV2/VerificationKeyAccount/g' {} \;

# In TypeScript files
find sdk -name "*.ts" -exec sed -i 's/PsolV2Client/WhiteProtocolClient/g' {} \;
find sdk -name "*.ts" -exec sed -i 's/createPsolClient/createWhiteProtocolClient/g' {} \;
find sdk -name "*.ts" -exec sed -i 's/PsolV2ClientOptions/WhiteProtocolClientOptions/g' {} \;
```

**Note:** Always review changes after running sed commands!

---

## Backwards Compatibility Strategy

### Option 1: Keep Old Seeds (Minimal Breaking Change)
```rust
// Keep these for compatibility with existing deployments
pub const SEED_PREFIX: &'static [u8] = b"pool_v2";  // Keep old
// or
pub const SEED_PREFIX: &'static [u8] = b"white_pool"; // New deployment only
```

### Option 2: Dual SDK Support
```typescript
// Export both names during transition
export { WhiteProtocolClient as PsolV2Client }; // Alias
export { createWhiteProtocolClient as createPsolClient }; // Alias
```

---

## Checklist for Code Review

Before committing:
- [ ] No `psol_privacy_v2` strings remain (except IDL filename temporarily)
- [ ] No `PrivacyErrorV2` references remain
- [ ] No `PoolConfigV2` references remain
- [ ] No `PsolV2Client` references remain
- [ ] All imports resolve correctly
- [ ] `cargo build` succeeds
- [ ] `anchor build` succeeds
- [ ] SDK builds successfully
- [ ] Relayer builds successfully

---

*Reference Version: 1.0*
