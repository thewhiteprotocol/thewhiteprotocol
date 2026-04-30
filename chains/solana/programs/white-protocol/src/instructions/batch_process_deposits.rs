use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::BatchProcessedEvent;
use crate::state::{MerkleTree, PendingDepositsBuffer, PoolConfig};
use crate::utils::cu;

/// Maximum deposits to process in a single batch
///
/// Set to 10 to stay well within Solana 1.4M CU limits.
/// Each insertion does ~20 Poseidon hashes (one per tree level).
/// At ~3,000 CU per hash + overhead, 10 leaves leaves comfortable headroom.
pub const MAX_BATCH_SIZE: u16 = 10;

/// Accounts for batch processing deposits (authority-only; no batcher_role account required)
#[derive(Accounts)]
pub struct BatchProcessDeposits<'info> {
    /// Batcher (must be pool authority)
    #[account(mut)]
    pub batcher: Signer<'info>,

    /// Pool configuration
    #[account(
        mut,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
        has_one = merkle_tree @ WhiteProtocolError::InvalidMerkleTreePool,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    /// Merkle tree account
    #[account(mut)]
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
}

/// Handler for batch_process_deposits instruction (authority-only)
pub fn handler(ctx: Context<BatchProcessDeposits>, max_to_process: u16) -> Result<()> {
    cu("batch: start");

    let pool_config = &mut ctx.accounts.pool_config;
    let merkle_tree = &mut ctx.accounts.merkle_tree;
    let pending_buffer = &mut ctx.accounts.pending_buffer;
    let batcher = ctx.accounts.batcher.key();

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // =========================================================================
    // 1. AUTHORIZATION CHECK (AUTHORITY ONLY)
    // =========================================================================
    require_keys_eq!(
        batcher,
        pool_config.authority,
        WhiteProtocolError::Unauthorized
    );
    cu("batch: after auth");

    // =========================================================================
    // 2. VALIDATE BATCH PARAMETERS
    // =========================================================================
    require!(
        !pending_buffer.is_empty(),
        WhiteProtocolError::NoPendingDeposits
    );

    require!(
        max_to_process > 0 && max_to_process <= MAX_BATCH_SIZE,
        WhiteProtocolError::InvalidBatchSize
    );

    // Check timing constraints (always enforce MIN_BATCH_INTERVAL_SECONDS)
    require!(
        pending_buffer.should_batch(timestamp),
        WhiteProtocolError::BatchNotReady
    );

    // =========================================================================
    // 3. VALIDATE MERKLE TREE CAPACITY
    // =========================================================================
    let to_process = std::cmp::min(max_to_process as usize, pending_buffer.size());

    let tree_capacity = merkle_tree.capacity();
    let tree_used = merkle_tree.next_leaf_index as usize;

    require!(
        tree_used + to_process <= tree_capacity as usize,
        WhiteProtocolError::MerkleTreeFull
    );

    // =========================================================================
    // 4. PROCESS DEPOSITS
    // =========================================================================
    cu("batch: before prepare_batch");
    let deposits_to_process = pending_buffer.prepare_batch(max_to_process);
    cu("batch: after prepare_batch");

    let actual_count = deposits_to_process.len();
    require!(actual_count > 0, WhiteProtocolError::NoPendingDeposits);

    let start_leaf_index = merkle_tree.next_leaf_index;

    // Insert each commitment into Merkle tree
    cu("batch: insert_leaf loop start");
    for deposit in deposits_to_process {
        require!(
            !deposit.commitment.iter().all(|&b| b == 0),
            WhiteProtocolError::InvalidCommitment
        );

        cu("batch: before insert_leaf");
        merkle_tree.insert_leaf(deposit.commitment, deposit.timestamp)?;
        cu("batch: after insert_leaf");
    }

    let end_leaf_index = merkle_tree.next_leaf_index - 1;
    let final_merkle_root = merkle_tree.get_current_root();

    // =========================================================================
    // 5. UPDATE BUFFER
    // =========================================================================
    pending_buffer.clear_processed(actual_count as u32, timestamp)?;

    // =========================================================================
    // 6. UPDATE POOL STATISTICS
    // =========================================================================
    pool_config.record_batch(actual_count as u32, timestamp)?;

    // =========================================================================
    // 7. EMIT BATCH EVENT
    // =========================================================================
    emit!(BatchProcessedEvent {
        pool: ctx.accounts.pool_config.key(),
        deposits_processed: actual_count as u16,
        first_leaf_index: start_leaf_index,
        last_leaf_index: end_leaf_index,
        new_merkle_root: final_merkle_root,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "Batch processed: {} deposits (indices {}-{})",
        actual_count,
        start_leaf_index,
        end_leaf_index
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_batch_size_compute_budget() {
        const CU_PER_INSERTION: u32 = 20_000;
        const SOLANA_CU_LIMIT: u32 = 1_400_000;
        const OVERHEAD_CU: u32 = 400_000;

        let batch_cu = MAX_BATCH_SIZE as u32 * CU_PER_INSERTION;
        assert!(
            batch_cu + OVERHEAD_CU <= SOLANA_CU_LIMIT,
            "MAX_BATCH_SIZE {} exceeds compute budget: {} CU needed, {} CU available",
            MAX_BATCH_SIZE,
            batch_cu + OVERHEAD_CU,
            SOLANA_CU_LIMIT
        );
    }
}
