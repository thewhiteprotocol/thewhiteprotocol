use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;

/// Maximum pending deposits in buffer
///
/// Limited to prevent account bloat and ensure batch processing
/// fits within Solana compute unit limits.
pub const MAX_PENDING_DEPOSITS: usize = 100;

/// Minimum time between batches (seconds)
///
/// Prevents spam batching attacks.
pub const MIN_BATCH_INTERVAL_SECONDS: i64 = 60;

/// Individual pending deposit entry (PRIVACY-SAFE)
///
/// Contains ONLY:
/// - Commitment (privacy-preserving hash)
/// - Timestamp (for ordering/timing)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingDeposit {
    /// Poseidon commitment = H(secret, nullifier, amount, asset_id)
    ///
    /// This is a one-way hash and reveals nothing about:
    /// - Who deposited
    /// - How much was deposited
    /// - Which asset was deposited (unless only one asset in pool)
    pub commitment: [u8; 32],

    /// Timestamp when deposit was added to buffer
    ///
    /// Used for:
    /// - Ordering deposits (FIFO processing)
    /// - Time-based batch triggering
    /// - Analytics (non-privacy-sensitive)
    pub timestamp: i64,
}

impl PendingDeposit {
    pub const LEN: usize = 32   // commitment
        + 8; // timestamp

    /// Create a new pending deposit entry
    pub fn new(commitment: [u8; 32], timestamp: i64) -> Self {
        Self {
            commitment,
            timestamp,
        }
    }
}

/// Pending Deposits Buffer Account
///
/// PDA Seeds: `[b"pending", pool.key().as_ref()]`
#[account]
pub struct PendingDepositsBuffer {
    /// Reference to parent pool
    pub pool: Pubkey,

    /// Pending deposits (max 100)
    ///
    /// Privacy-safe: Contains only commitments and timestamps.
    /// No depositor addresses or amounts stored.
    pub deposits: Vec<PendingDeposit>,

    /// Total deposits currently pending
    pub total_pending: u32,

    /// Last batch processing timestamp
    pub last_batch_at: i64,

    /// Total batches processed (statistics)
    pub total_batches_processed: u64,

    /// Total deposits ever batched (statistics)
    pub total_deposits_batched: u64,

    /// PDA bump seed
    pub bump: u8,

    /// Buffer version
    pub version: u8,
}

impl PendingDepositsBuffer {
    pub const SEED_PREFIX: &'static [u8] = b"pending";

    /// Calculate space for pending deposits buffer
    pub const LEN: usize = 8                                    // discriminator
        + 32                                                    // pool
        + 4 + (PendingDeposit::LEN * MAX_PENDING_DEPOSITS)     // deposits vec
        + 4                                                     // total_pending
        + 8                                                     // last_batch_at
        + 8                                                     // total_batches_processed
        + 8                                                     // total_deposits_batched
        + 1                                                     // bump
        + 1; // version

    pub const VERSION: u8 = 1;

    /// Initialize the pending deposits buffer
    pub fn initialize(&mut self, pool: Pubkey, bump: u8, timestamp: i64) {
        self.pool = pool;
        self.deposits = Vec::with_capacity(MAX_PENDING_DEPOSITS);
        self.total_pending = 0;
        self.last_batch_at = timestamp;
        self.total_batches_processed = 0;
        self.total_deposits_batched = 0;
        self.bump = bump;
        self.version = Self::VERSION;
    }

    /// Add a pending deposit to the buffer
    ///
    /// # Arguments
    /// * `commitment` - Poseidon commitment hash
    /// * `timestamp` - Current timestamp
    ///
    /// # Errors
    /// - `BufferFull` if buffer is at capacity
    /// - `InvalidCommitment` if commitment is zero
    ///
    /// # Returns
    /// Index of the deposit in the buffer
    pub fn add_pending(&mut self, commitment: [u8; 32], timestamp: i64) -> Result<usize> {
        // Check buffer not full
        require!(!self.is_full(), WhiteProtocolError::BufferFull);

        // Validate commitment is not zero (reserved for empty Merkle leaves)
        require!(
            !commitment.iter().all(|&b| b == 0),
            WhiteProtocolError::InvalidCommitment
        );

        // SECURITY: Reject duplicates inside the buffer
        for deposit in &self.deposits {
            require!(
                deposit.commitment != commitment,
                WhiteProtocolError::CommitmentAlreadyExists
            );
        }

        // Create pending deposit entry
        let pending = PendingDeposit::new(commitment, timestamp);

        // Add to buffer
        self.deposits.push(pending);
        self.total_pending = self
            .total_pending
            .checked_add(1)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;

        // Return index in buffer
        Ok(self.deposits.len() - 1)
    }

    /// Process a batch of deposits
    ///
    /// # Arguments
    /// * `max_to_process` - Maximum number of deposits to process
    /// * `timestamp` - Batch processing timestamp
    ///
    /// # Returns
    /// Slice of deposits to process (up to max_to_process)
    ///
    /// # Note
    /// Call `clear_processed()` after successful Merkle insertion
    pub fn prepare_batch(&self, max_to_process: u16) -> &[PendingDeposit] {
        let to_process = std::cmp::min(max_to_process as usize, self.deposits.len());

        &self.deposits[..to_process]
    }

    /// Clear processed deposits from buffer
    ///
    /// # Arguments
    /// * `count` - Number of deposits successfully processed
    /// * `timestamp` - Batch processing timestamp
    ///
    /// # Errors
    /// - `InvalidBatchSize` if count > total_pending
    pub fn clear_processed(&mut self, count: u32, timestamp: i64) -> Result<()> {
        // Validate count
        require!(
            count <= self.total_pending,
            WhiteProtocolError::InvalidBatchSize
        );

        // Remove processed entries from front
        self.deposits.drain(..count as usize);

        // Update statistics
        self.total_pending = self
            .total_pending
            .checked_sub(count)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;

        self.total_batches_processed = self
            .total_batches_processed
            .checked_add(1)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;

        self.total_deposits_batched = self
            .total_deposits_batched
            .checked_add(count as u64)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;

        self.last_batch_at = timestamp;

        Ok(())
    }

    /// Check if buffer is full
    pub fn is_full(&self) -> bool {
        self.deposits.len() >= MAX_PENDING_DEPOSITS
    }

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool {
        self.deposits.is_empty()
    }

    /// Get current buffer size
    pub fn size(&self) -> usize {
        self.deposits.len()
    }

    /// Check if enough time has passed since last batch
    pub fn can_batch_by_time(&self, current_timestamp: i64) -> bool {
        let elapsed = current_timestamp.saturating_sub(self.last_batch_at);
        elapsed >= MIN_BATCH_INTERVAL_SECONDS
    }

    /// Check if batch should be processed
    ///
    /// Returns true if:
    /// - Buffer is not empty AND
    /// - (Buffer is full OR enough time has passed)
    pub fn should_batch(&self, current_timestamp: i64) -> bool {
        !self.is_empty() && (self.is_full() || self.can_batch_by_time(current_timestamp))
    }
}

#[cfg(test)]
#[allow(clippy::assertions_on_constants)]
mod tests {
    use super::*;

    #[test]
    fn test_buffer_space_calculation() {
        // Ensure buffer size is reasonable (< 5KB without data)
        let base_size = 8 + 32 + 4 + 4 + 8 + 8 + 8 + 1 + 1;
        assert!(base_size < 5_000);

        // With full buffer: ~4KB + 40*100 = ~8KB (acceptable)
        assert!(PendingDepositsBuffer::LEN < 10_000);
    }

    #[test]
    fn test_pending_deposit_size() {
        // Should be 40 bytes (32 + 8)
        assert_eq!(PendingDeposit::LEN, 40);
    }

    #[test]
    fn test_privacy_safety() {
        let deposit = PendingDeposit::new([1u8; 32], 1000);

        // Should ONLY contain commitment and timestamp
        // No depositor, no amount, no asset_id
        assert_eq!(deposit.commitment, [1u8; 32]);
        assert_eq!(deposit.timestamp, 1000);
    }
}
