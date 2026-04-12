# E2E Test Status - The White Protocol

## Summary
**Date:** 2026-04-12

### Completed ✓
1. **Stack overflow fix** - Applied Box<> wrapping and release profile optimizations
2. **Program deployment** - Successfully deployed to devnet
   - Program ID: `C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW`
3. **E2E Test 1 (Deposit wSOL)** - PASSED
   - Transaction: `4qNhrsaEvubeL6qxsXpUEoatjMhFWAietrnqzNq7DB8VSQy5LxakWPCUnSHt1qZdqFEWwT4JF8KMhRBTeppvMduZ`
   - Real ZK proof verification working (121K CU)

### In Progress
4. **Merkle Batch Update Circuit**
   - Circuit compiled: ✓ (39,648 constraints, 5 public inputs, 6 IC points)
   - WASM witness generator: ✓
   - Verification key: ✓
   - **Proving key (zkey): INCOMPLETE** - Trusted setup times out in this environment

### Blocked
5. **E2E Test 2 (Withdraw wSOL)** - Blocked by batch settlement
   - Requires `settle_deposits_batch` instruction with off-chain ZK proof
   - Needs complete proving key for MerkleBatchUpdate circuit

## Technical Details

### Circuit Configuration
```
Template: MerkleBatchUpdate(depth=20, maxBatch=1)
Constraints: 39,648 (fits within 2^16 = 65,536)
Public Inputs: 5 (oldRoot, newRoot, startIndex, batchSize, commitmentsHash)
IC Points: 6
```

### File Locations
```
circuits/build/merkle_batch_update/
├── merkle_batch_update.r1cs          ✓
├── merkle_batch_update.sym           ✓
├── merkle_batch_update_js/
│   └── merkle_batch_update.wasm      ✓
├── verification_key.json             ✓
└── merkle_batch_update.zkey          ⚠️ INCOMPLETE
```

### Why Batch Settlement?
The original `batch_process_deposits` instruction exceeded 1.4M CU limit due to on-chain Poseidon hashing. The solution uses `settle_deposits_batch` with off-chain Groth16 proof verification, reducing CU from 1.4M to ~300K.

## Next Steps

### Option 1: Complete Trusted Setup Locally
Run the trusted setup on a machine with sufficient resources:

```bash
cd circuits/build/merkle_batch_update

# This takes ~10-30 minutes depending on hardware
snarkjs groth16 setup merkle_batch_update.r1cs ../powersOfTau28_hez_final_16.ptau merkle_batch_update_0000.zkey

snarkjs zkey contribute merkle_batch_update_0000.zkey merkle_batch_update_0001.zkey \
  --name="Local Setup" -v -e="random entropy"

snarkjs zkey beacon merkle_batch_update_0001.zkey merkle_batch_update_final.zkey \
  0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f 10 \
  -n="Final Beacon"

# Then upload the new VK to the program if needed
```

### Option 2: Use Existing Infrastructure
If the MerkleBatchUpdate VK was already uploaded (check with `check-vks-finalized.ts`):
- Use the existing proving key from the original pSOL deployment
- Test the `settle_deposits_batch` instruction directly

### Option 3: Simplified Testing
For quick testing without batch settlement:
1. Modify the program to skip Merkle tree updates for testing
2. Test withdraw with a pre-initialized note
3. Run full integration later with complete setup

## Current Infrastructure Status

| Component | Status | PDA/Address |
|-----------|--------|-------------|
| Program | ✓ Deployed | C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW |
| Pool Config | ✓ Initialized | EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS |
| Merkle Tree | ✓ Initialized | 2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD |
| Pending Buffer | ✓ Initialized | 7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw |
| wSOL Vault | ✓ Initialized | 629JMEcz1u4AjyahByEcQtyGF3TwDnBPY7nHhaLVB9PS |
| Deposit VK | ✓ Uploaded | Available |
| MerkleBatchUpdate VK | ? Unknown | Check with check-vks-finalized.ts |

## Test Commands

### Check VKs
```bash
npx tsx scripts/check-vks-finalized.ts
```

### Test Deposit (Working)
```bash
npx tsx tests/deposit-withdraw-integration.ts
```

### Test Batch Settlement (Blocked)
```bash
# Requires complete zkey
npx tsx scripts/test-settle-deposits-batch.ts
```

### Test Withdraw (Blocked)
```bash
# Requires batch settlement first
npx tsx tests/test-withdraw-e2e-fixed.ts
```

## Notes
- Devnet deployment has 15+ SOL in deployer wallet
- All naming references successfully rebranded from pSOL
- Circuit compilation and witness generation work correctly
- Only the trusted setup ceremony is blocking progress
