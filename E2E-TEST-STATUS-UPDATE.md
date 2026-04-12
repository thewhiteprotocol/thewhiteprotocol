# E2E Test Status Update - The White Protocol

**Date:** 2026-04-12

## Summary of Changes Made

### 1. ✅ Fixed MerkleBatchUpdate VK
**Problem:** The VK at `515Ysrg6j9FHdFfCzzEcHvqGsTfU2LtxsZME4UuU6CLN` was uploaded with proof type 4 but stored as Membership in the account data.

**Solution:**
- Added `close_vk_v2` instruction to the program (allows authority to close VK accounts)
- Deployed program upgrade (slot 454932832, size 1033528 bytes)
- Closed the wrong VK account using manual transaction
- Reuploaded VK with correct proof type (4 = MerkleBatchUpdate)

**Verification:**
```
VK PDA: 515Ysrg6j9FHdFfCzzEcHvqGsTfU2LtxsZME4UuU6CLN
Proof Type: 4 (MerkleBatchUpdate)
IC Points: 6
Status: Locked and initialized
```

### 2. ✅ Proof Generation Working
The merkle batch update circuit:
- Constraints: 39,648
- Public inputs: 5 (oldRoot, newRoot, startIndex, batchSize, commitmentsHash)
- IC points: 6
- Proof generation: Working
- Local verification: Passing

### 3. ⚠️ Current Blocker: Pending Buffer Empty
The `settle_deposits_batch` instruction requires:
1. Deposits in the pending buffer
2. A proof generated with those specific commitments
3. The commitments hash matching the pending deposits

**Current State:**
```
Merkle Tree:
  Current Root: 2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e
  Next Leaf Index: 0

Pending Buffer:
  Status: Account exists but no deposits
```

## Next Steps to Complete E2E Test

### Option 1: Use Existing Deposit Infrastructure
If there's an existing deposit test that generates valid proofs:
```bash
# Run deposit test first
npx tsx scripts/create-test-deposit.ts

# Then settle
npx tsx scripts/test-settle-deposits-batch.ts
```

### Option 2: Generate Deposit Proof
Need to:
1. Compile deposit circuit (if not already done)
2. Run trusted setup for deposit circuit
3. Generate deposit proof
4. Submit deposit
5. Generate batch settlement proof
6. Submit batch settlement

### Option 3: Test with Mock Data (Developer Only)
Modify the program to bypass proof verification for testing:
```rust
// In settle_deposits_batch.rs, temporarily disable:
// let is_valid = verify(&vk, &proof, &public_inputs)?;
// require!(is_valid, WhiteProtocolError::InvalidProof);
```

## Files Modified

### Program Changes
- `programs/white-protocol/src/instructions/set_verification_key_chunked.rs`
  - Added `CloseVkV2` accounts struct
  - Added `close_vk_handler` function
  
- `programs/white-protocol/src/instructions/mod.rs`
  - Exported `CloseVkV2`

- `programs/white-protocol/src/lib.rs`
  - Added `close_vk_v2` instruction
  - Added export for `__client_accounts_close_vk_v2`

### Scripts Created
- `scripts/close-vk-manual.ts` - Manually close VK using raw instruction
- `scripts/upload-vk-manual.ts` - Manually upload VK with correct type
- `scripts/test-settle-deposits-batch.ts` - Test batch settlement

## Program Deployment

```
Program ID: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW
Authority: 8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey
Last Deployed: Slot 454932832
Data Length: 1033528 bytes
```

## Infrastructure Status

| Component | Status | Notes |
|-----------|--------|-------|
| MerkleBatchUpdate Circuit | ✅ | 39,648 constraints, zkey generated |
| MerkleBatchUpdate VK | ✅ | Uploaded with correct proof type |
| Deposit Circuit | ? | Need to verify/test |
| Deposit VK | ✅ | Already uploaded |
| Pool Config | ✅ | Initialized |
| Merkle Tree | ✅ | Empty, ready for deposits |
| Pending Buffer | ✅ | Initialized, empty |

## Testing Commands

```bash
# Check VK
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx tsx scripts/compare-vk.ts

# Generate batch proof
npx tsx scripts/test-batch-proof.ts

# Test batch settlement (requires deposits)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx tsx scripts/test-settle-deposits-batch.ts
```

## Conclusion

The infrastructure is now correctly set up:
1. ✅ Circuit compilation and trusted setup
2. ✅ VK uploaded with correct proof type
3. ✅ Proof generation and verification working
4. ⏳ Need deposits in pending buffer for full E2E test

The batch settlement instruction should work once there are deposits to settle. The main blocker is generating a valid deposit proof to populate the pending buffer.
