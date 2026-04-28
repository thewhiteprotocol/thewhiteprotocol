//! Settle Deposits Batch - Production-grade off-chain proof verification
//!
//! Replaces on-chain Merkle insertion (which exceeds CU limits) with
//! off-chain proof generation + on-chain verification.
//!
//! Flow:
//! 1. Sequencer reads pending deposits from buffer
//! 2. Sequencer computes new Merkle root off-chain
//! 3. Sequencer generates Groth16 proof
//! 4. This instruction verifies proof and updates state

use anchor_lang::prelude::*;
use crate::crypto::groth16::{verify, Proof, VerificationKey};
use crate::error::WhiteProtocolError;
use crate::events::{BatchSettledEvent, CommitmentInsertedEvent};
use crate::state::{MerkleTree, PendingDepositsBuffer, PoolConfig, VerificationKeyAccount};
use crate::ProofType;

/// Maximum batch size must match circuit's maxBatch parameter
pub const MAX_BATCH_SIZE: usize = 1;

/// Accounts for settle_deposits_batch instruction
#[derive(Accounts)]
pub struct SettleDepositsBatch<'info> {
    /// Authority performing the settlement (must be pool authority)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Pool configuration
    #[account(
        mut,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
        constraint = pool_config.authority == authority.key() @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    /// Merkle tree account
    #[account(
        mut,
        constraint = pool_config.merkle_tree == merkle_tree.key() @ WhiteProtocolError::InvalidMerkleTreePool,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    /// Pending deposits buffer
    #[account(
        mut,
        seeds = [
            PendingDepositsBuffer::SEED_PREFIX,
            pool_config.key().as_ref(),
        ],
        bump = pending_buffer.bump,
        constraint = pending_buffer.pool == pool_config.key() @ WhiteProtocolError::InvalidPoolReference,
    )]
    pub pending_buffer: Box<Account<'info, PendingDepositsBuffer>>,

    /// Verification key for MerkleBatchUpdate proof type
    #[account(
        seeds = [
            ProofType::MerkleBatchUpdate.as_seed(),
            pool_config.key().as_ref(),
        ],
        bump,
        constraint = verification_key.is_valid() @ WhiteProtocolError::VerificationKeyNotSet,
        constraint = verification_key.proof_type == ProofType::MerkleBatchUpdate as u8 @ WhiteProtocolError::InvalidVerificationKeyType,
    )]
    pub verification_key: Box<Account<'info, VerificationKeyAccount>>,
}

/// Arguments for settle_deposits_batch
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct SettleDepositsBatchArgs {
    /// Groth16 proof bytes (256 bytes: A + B + C)
    pub proof: [u8; 256],
    /// New Merkle root after insertions
    pub new_root: [u8; 32],
    pub batch_size: u16,
}

/// Convert sha256 output to BN254 field element
/// Takes lower 253 bits to ensure result < field modulus
/// MUST match circuit's Sha256ToField template
fn sha256_to_field(hash: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    // Copy all 32 bytes
    result.copy_from_slice(hash);
    // Zero out the top 3 bits to get 253 bits (ensures < p)
    // Big-endian: top bits are in result[0]
    result[0] &= 0x1F; // 0001_1111 - keeps lower 5 bits of first byte
    result
}

/// Compute commitments hash matching circuit encoding
/// Circuit hashes MAX_BATCH_SIZE slots, inactive slots are 0
/// 
/// SECURITY: Commitments are Poseidon hashes which are guaranteed to be < P
/// (BN254 base field). We keep the reduction logic for defense-in-depth
/// but use a proper loop to handle any value.
fn compute_commitments_hash(commitments: &[[u8; 32]], batch_size: usize) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    
    // BN254 prime p (big-endian)
    const P: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
        0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
        0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
        0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
    ];
    
    let mut preimage = [0u8; MAX_BATCH_SIZE * 32];
    
    for i in 0..MAX_BATCH_SIZE {
        if i < batch_size && i < commitments.len() {
            let c = &commitments[i];
            // Proper modular reduction: subtract P while c >= P
            let mut current = *c;
            while is_gte_big_endian(&current, &P) {
                current = sub_big_endian(&current, &P);
            }
            preimage[i * 32..(i + 1) * 32].copy_from_slice(&current);
        }
    }
    
    let hash = Sha256::digest(&preimage);
    let mut h = [0u8; 32];
    h.copy_from_slice(&hash);
    h
}

/// Compare two 32-byte big-endian numbers: a >= b
fn is_gte_big_endian(a: &[u8; 32], b: &[u8; 32]) -> bool {
    for i in 0..32 {
        if a[i] > b[i] { return true; }
        if a[i] < b[i] { return false; }
    }
    true // equal
}

/// Subtract two 32-byte big-endian numbers: a - b (assumes a >= b)
fn sub_big_endian(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut borrow = 0i16;
    for j in (0..32).rev() {
        let diff = a[j] as i16 - b[j] as i16 - borrow;
        if diff < 0 {
            result[j] = (diff + 256) as u8;
            borrow = 1;
        } else {
            result[j] = diff as u8;
            borrow = 0;
        }
    }
    result
}


/// Handler for settle_deposits_batch instruction
pub fn handler(ctx: Context<SettleDepositsBatch>, args: SettleDepositsBatchArgs) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;
    let merkle_tree = &mut ctx.accounts.merkle_tree;
    let pending_buffer = &mut ctx.accounts.pending_buffer;
    let vk_account = &ctx.accounts.verification_key;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // =========================================================================
    // 1. VALIDATE BATCH SIZE
    // =========================================================================
    let batch_size = args.batch_size as usize;

    require!(batch_size > 0, WhiteProtocolError::InvalidBatchSize);
    require!(
        batch_size <= MAX_BATCH_SIZE,
        WhiteProtocolError::InvalidBatchSize
    );
    require!(
        batch_size <= pending_buffer.size(),
        WhiteProtocolError::InvalidBatchSize
    );

    // =========================================================================
    // 2. GET CURRENT STATE FOR PUBLIC INPUTS
    // =========================================================================
    let old_root = merkle_tree.get_current_root();
    let start_index = merkle_tree.next_leaf_index;

    // Check tree has capacity
    let tree_capacity = merkle_tree.capacity();
    require!(
        (start_index as usize) + batch_size <= tree_capacity as usize,
        WhiteProtocolError::MerkleTreeFull
    );

    // =========================================================================
    // 3. GET COMMITMENTS AND COMPUTE HASH
    // =========================================================================
    let pending_deposits = pending_buffer.prepare_batch(batch_size as u16);
    let commitments: Vec<[u8; 32]> = pending_deposits.iter().map(|d| d.commitment).collect();

    // Compute sha256 hash matching circuit encoding
    let commitments_sha256 = compute_commitments_hash(&commitments, batch_size);

    // Convert to field element (take lower 253 bits)
    let commitments_hash_field = sha256_to_field(&commitments_sha256);

    // =========================================================================
    // 4. BUILD PUBLIC INPUTS
    // =========================================================================
    // Order must match circuit: oldRoot, newRoot, startIndex, batchSize, commitmentsHash
    let start_index_scalar = u64_to_scalar_be(start_index as u64);
    let batch_size_scalar = u64_to_scalar_be(batch_size as u64);

    let public_inputs: [[u8; 32]; 5] = [
        old_root,
        args.new_root,
        start_index_scalar,
        batch_size_scalar,
        commitments_hash_field,
    ];

    // =========================================================================
    // 5. VERIFY GROTH16 PROOF
    // =========================================================================
    #[cfg(feature = "event-debug")]
    {
        msg!("[SETTLE] old_root={}", hex::encode(old_root));
        msg!("[SETTLE] new_root={}", hex::encode(args.new_root));
        msg!("[SETTLE] start_index={}", start_index);
        msg!("[SETTLE] batch_size={}", batch_size);
        msg!("[SETTLE] commitments_hash={}", hex::encode(commitments_hash_field));
    }

    let proof = Proof::from_bytes(&args.proof)?;

    let vk = VerificationKey::from_account(
        &vk_account.vk_alpha_g1,
        &vk_account.vk_beta_g2,
        &vk_account.vk_gamma_g2,
        &vk_account.vk_delta_g2,
        &vk_account.vk_ic,
    );

    #[cfg(feature = "event-debug")]
    msg!("[SETTLE] Calling verify()...");

    let is_valid = verify(&vk, &proof, &public_inputs)?;

    #[cfg(feature = "event-debug")]
    msg!("[SETTLE] verify() returned: {}", is_valid);

    require!(is_valid, WhiteProtocolError::InvalidProof);

    // =========================================================================
    // 5b. REPLAY INCREMENTAL INSERTIONS TO UPDATE filled_subtrees
    // =========================================================================
    // The proof verified the root transition off-chain, but the on-chain tree
    // account must still keep filled_subtrees consistent so that future
    // batch_process_deposits and get_merkle_path calls remain correct.
    // For MAX_BATCH_SIZE=1 this is ~depth Poseidon hashes (~60k CU).
    //
    // NOTE: Skip replay if filled_subtrees is known to be corrupted from
    // pre-upgrade settlements that did not update filled_subtrees. In that
    // case the Groth16 proof is the only source of truth for the root transition.
    let filled_subtrees_corrupted = merkle_tree.next_leaf_index > 0
        && merkle_tree.filled_subtrees.iter().all(|h| crate::crypto::is_zero_hash(h));

    if !filled_subtrees_corrupted {
        let computed_root = merkle_tree.replay_insertions(&commitments, start_index)?;

        // Defense-in-depth: on-chain recomputation must agree with the proof
        require!(
            computed_root == args.new_root,
            WhiteProtocolError::InvalidProof
        );
    }

    // =========================================================================
    // 6. UPDATE MERKLE TREE STATE
    // =========================================================================
    merkle_tree.current_root = args.new_root;
    merkle_tree.next_leaf_index = start_index + batch_size as u32;
    merkle_tree.total_leaves = merkle_tree
        .total_leaves
        .checked_add(batch_size as u64)
        .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
    merkle_tree.last_insertion_at = timestamp;

    // Add to root history
    // Add to root history (circular buffer)
    let history_idx = merkle_tree.root_history_index as usize;
    merkle_tree.root_history[history_idx] = args.new_root;
    merkle_tree.root_history_index =
        (merkle_tree.root_history_index + 1) % merkle_tree.root_history_size;

    // =========================================================================
    // 6b. EMIT PER-COMMITMENT EVENTS (RECOVERY LOG)
    // =========================================================================
    // Critical for sequencer recoverability - allows deterministic tree rebuild
    for (i, commitment) in commitments.iter().enumerate() {
        let leaf_index = start_index + i as u32;
        emit!(CommitmentInsertedEvent {
            pool: pool_config.key(),
            commitment: *commitment,
            leaf_index,
            merkle_root: args.new_root,
            timestamp,
        });
    }

    // =========================================================================
    // 7. CLEAR PROCESSED DEPOSITS FROM BUFFER
    // =========================================================================
    pending_buffer.clear_processed(batch_size as u32, timestamp)?;

    // =========================================================================
    // 8. UPDATE POOL STATISTICS
    // =========================================================================
    pool_config.record_batch(batch_size as u32, timestamp)?;

    // =========================================================================
    // 9. EMIT EVENT
    // =========================================================================
    emit!(BatchSettledEvent {
        pool: pool_config.key(),
        batch_size: batch_size as u16,
        start_index,
        new_root: args.new_root,
        commitments_hash: commitments_sha256,
        timestamp,
    });

    Ok(())
}

/// Convert u64 to 32-byte big-endian scalar
fn u64_to_scalar_be(value: u64) -> [u8; 32] {
    let mut scalar = [0u8; 32];
    scalar[24..32].copy_from_slice(&value.to_be_bytes());
    scalar
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_to_field() {
        // All ones should have top 3 bits cleared
        let hash = [0xFF; 32];
        let field = sha256_to_field(&hash);
        assert_eq!(field[0], 0x1F); // Top 3 bits cleared
        assert_eq!(field[1], 0xFF); // Rest unchanged
    }

    #[test]
    fn test_u64_to_scalar_be() {
        let scalar = u64_to_scalar_be(1);
        assert_eq!(scalar[31], 1);
        assert_eq!(scalar[0], 0);

        let scalar = u64_to_scalar_be(256);
        assert_eq!(scalar[30], 1);
        assert_eq!(scalar[31], 0);
    }

    #[test]
    fn test_compute_commitments_hash() {
        let commitment = [0x42u8; 32];
        let commitments = vec![commitment];
        let hash = compute_commitments_hash(&commitments, 1);

        // Should be non-zero
        assert!(hash.iter().any(|&b| b != 0));
    }
}
