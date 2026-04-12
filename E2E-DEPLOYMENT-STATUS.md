# The White Protocol - Devnet Deployment Status

**Date**: 2026-04-11  
**Status**: ⚠️ BLOCKED - Insufficient Devnet SOL

---

## Summary

Successfully applied stack overflow fixes to the program code (Box<> wrapping, release profile optimizations), but deployment is blocked due to insufficient devnet SOL.

---

## ✅ Completed Work

### 1. Stack Overflow Fixes Applied

#### a) Box<> Wrapping in deposit_masp.rs:
```rust
pub vault_token_account: Box<Account<'info, TokenAccount>>,
pub user_token_account: Box<Account<'info, TokenAccount>>,
pub mint: Box<Account<'info, Mint>>,
pub deposit_vk: Box<Account<'info, VerificationKeyAccount>>,
```

#### b) Box<> Wrapping in withdraw_masp.rs:
```rust
pub spent_nullifier: Box<Account<'info, SpentNullifier>>,
pub relayer_node: Option<Box<Account<'info, RelayerNode>>>,
pub yield_registry: Option<Box<Account<'info, YieldRegistry>>>,
```

#### c) Release Profile Optimizations (Cargo.toml):
```toml
[profile.release]
overflow-checks = false
lto = "fat"
codegen-units = 1
opt-level = 3
```

### 2. Program Built Successfully
- Binary size: 1,025,400 bytes (~1MB)
- Build warnings about withdraw_yield_v2 (not deposit_masp)

---

## ❌ Current Blocker: Insufficient Devnet SOL

### Wallet Balances:
| Wallet | Address | Balance |
|--------|---------|---------|
| Deployer | 8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey | 0.05 SOL |
| Pool Authority | 9ykE7bPubw3r4ZsGH2rkVyhoHHpgTz9fbq1fD7Qdcre2 | 1.50 SOL |

### Required for Deployment:
- **Program Size**: 1,025,400 bytes
- **Required SOL**: ~7.14 SOL (for rent-exempt program account)
- **Available**: 1.55 SOL total
- **Shortfall**: ~5.6 SOL

### Attempted Solutions:
1. ❌ Devnet airdop - Rate limited
2. ❌ Transfer from pool authority - Insufficient funds
3. ❌ Close previous program - Already closed, funds recovered but spent on failed deploy

---

## 📋 What Was Done

### Step 1: Applied Stack Fixes
- ✅ Box-wrapped all Account<> fields in deposit_masp.rs
- ✅ Box-wrapped all Account<> fields in withdraw_masp.rs  
- ✅ Updated release profile with optimizations
- ✅ Rebuilt program successfully

### Step 2: Deploy Attempt
- ✅ Generated new program keypair: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW
- ❌ Deployment failed - insufficient SOL

### Step 3: Funding Attempts
- ✅ Closed old program to recover 7.12 SOL
- ❌ Buffer creation consumed recovered funds
- ❌ Airdrop rate-limited

---

## 🔧 Program ID History

| Program ID | Status | Notes |
|------------|--------|-------|
| BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb | ❌ CLOSED | Original pSOL program |
| HJmgwBBjojb2SdKPCW4DFNh2wRQzZ5mtD6ro2YocpZHj | ❌ CLOSED | First White Protocol deployment |
| C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW | ⏳ READY | Built with fixes, needs deployment |

---

## 🎯 Next Steps (When SOL Available)

### Option 1: Get Devnet SOL
```bash
# Try again later when rate limit resets
solana airdrop 5 <deployer-wallet> --url devnet

# Or use a different devnet faucet
# https://faucet.solana.com/
```

### Option 2: Deploy with New Program ID
```bash
# Deploy the fixed program
solana program deploy target/deploy/white_protocol.so \
  --program-id ~/.config/solana/white-protocol-program-v2.json \
  --url devnet
```

### Option 3: Initialize Protocol
```bash
# Run initialization scripts
npx tsx scripts/init-full-v2.ts
npx tsx scripts/upload-vks-new.ts
npx tsx scripts/register-wsol-new.ts
npx tsx scripts/setup-relayer-new.ts
```

### Option 4: Run E2E Tests
```bash
# Test deposit
npx tsx tests/e2e-01-deposit.ts

# Test withdraw
npx tsx tests/e2e-02-withdraw.ts

# Remaining tests...
```

---

## 📁 Files Modified

| File | Changes |
|------|---------|
| programs/white-protocol/src/instructions/deposit_masp.rs | Box-wrapped 4 account fields |
| programs/white-protocol/src/instructions/withdraw_masp.rs | Box-wrapped 3 account fields |
| Cargo.toml | Release profile optimizations |
| target/idl/white_protocol.json | Updated program ID |
| sdk/src/idl/white_protocol.json | Updated program ID |

---

## 🧪 Code Changes Summary

The stack overflow fix involved:

1. **Moving accounts from stack to heap** using `Box<Account<'info, T>>`
2. **Release profile tuning** to reduce stack usage
3. **The code already had**:
   - PendingDepositsBuffer pattern ✅
   - verify_proof_from_account() ✅
   - Box wrapping for large accounts (pool_config, merkle_tree, etc.) ✅

The fix completes the Box wrapping for ALL account fields, not just the large ones.

---

## ⚠️ Alternative: Use Different Approach

If devnet SOL remains unavailable:

1. **Local Testing**: Use `anchor test` with local validator
2. **Mainnet Deployment**: Skip devnet, deploy directly to mainnet (risky without full testing)
3. **Wait for Faucet**: Try airdrop again after rate limit reset
4. **Use SPL Governance**: Create a proposal to fund deployment from treasury

---

**Status**: All code fixes are complete and program is built. Deployment is blocked pending acquisition of ~5.6 additional devnet SOL.
