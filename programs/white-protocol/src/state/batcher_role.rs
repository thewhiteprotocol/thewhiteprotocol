//! Batcher Role - Designated Batcher Authorization (CORRECTED)
//!
//! # Security Model
//!
//! Batch processing is a privileged operation that must be restricted to:
//! 1. Pool authority (always authorized)
//! 2. Designated batchers (via on-chain PDA allowlist)
//!
//! This prevents unauthorized batching and ensures designated batchers
//! are controlled by on-chain state, not user-provided instruction arguments.
//!
//! # PDA Seeds
//! `[b"batcher", pool.key().as_ref(), batcher.key().as_ref()]`
//!
//! # Authorization Pattern
//! ```rust,ignore
//! // Check if batcher is pool authority
//! if batcher.key() == pool_config.authority {
//!     // Always authorized
//!     Ok(())
//! } else {
//!     // Require BatcherRole PDA with is_enabled = true
//!     require!(batcher_role.is_enabled, Unauthorized);
//!     Ok(())
//! }
//! ```

use crate::error::WhiteProtocolError;
use anchor_lang::prelude::*; // CORRECTED: Import error type

/// Batcher Role PDA - On-Chain Authorization
///
/// Seeds: `[b"batcher", pool, batcher]`
#[account]
pub struct BatcherRole {
    /// Pool this batcher is authorized for
    pub pool: Pubkey,

    /// Batcher public key
    pub batcher: Pubkey,

    /// Is this batcher currently enabled
    pub is_enabled: bool,

    /// When this role was created
    pub created_at: i64,

    /// When this role was last modified
    pub updated_at: i64,

    /// Total batches processed by this batcher
    pub total_batches_processed: u64,

    /// Total deposits batched by this batcher
    pub total_deposits_batched: u64,

    /// PDA bump seed
    pub bump: u8,

    /// Account version
    pub version: u8,
}

impl BatcherRole {
    pub const SEED_PREFIX: &'static [u8] = b"batcher";

    /// Account size calculation
    pub const LEN: usize = 8  // discriminator
        + 32  // pool
        + 32  // batcher
        + 1   // is_enabled
        + 8   // created_at
        + 8   // updated_at
        + 8   // total_batches_processed
        + 8   // total_deposits_batched
        + 1   // bump
        + 1; // version

    pub const VERSION: u8 = 1;

    /// Initialize a batcher role
    pub fn initialize(&mut self, pool: Pubkey, batcher: Pubkey, bump: u8, timestamp: i64) {
        self.pool = pool;
        self.batcher = batcher;
        self.is_enabled = true;
        self.created_at = timestamp;
        self.updated_at = timestamp;
        self.total_batches_processed = 0;
        self.total_deposits_batched = 0;
        self.bump = bump;
        self.version = Self::VERSION;
    }

    /// Record a batch processed by this batcher
    pub fn record_batch(&mut self, deposits_count: u32, timestamp: i64) -> Result<()> {
        // CORRECTED: Use WhiteProtocolError instead of error::ErrorCode
        self.total_batches_processed = self
            .total_batches_processed
            .checked_add(1)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;

        self.total_deposits_batched = self
            .total_deposits_batched
            .checked_add(deposits_count as u64)
            .ok_or(WhiteProtocolError::ArithmeticOverflow)?;

        self.updated_at = timestamp;

        Ok(())
    }

    /// Enable this batcher
    pub fn enable(&mut self, timestamp: i64) {
        self.is_enabled = true;
        self.updated_at = timestamp;
    }

    /// Disable this batcher
    pub fn disable(&mut self, timestamp: i64) {
        self.is_enabled = false;
        self.updated_at = timestamp;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_batcher_role_size() {
        assert_eq!(BatcherRole::LEN, 107);
    }
}
