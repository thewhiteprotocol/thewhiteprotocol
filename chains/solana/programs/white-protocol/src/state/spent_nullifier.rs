//! Spent Nullifier tracking - The White Protocol v2
//!
//! # PDA-per-Nullifier Pattern
//! Each spent nullifier gets its own account for O(1) lookup.
//! This scales to unlimited nullifiers.
//!
//! # Join-Split Support
//! v2 nullifiers track which operation type spent them
//! (withdrawal vs join-split) for analytics and debugging.

use anchor_lang::prelude::*;

/// Operation type that spent the nullifier
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum SpendType {
    /// Spent via withdrawal
    Withdraw = 0,
    /// Spent via join-split transfer
    JoinSplit = 1,
    /// Spent via shielded CPI action
    ShieldedAction = 2,
}

/// Spent nullifier marker account - The White Protocol v2
///
/// PDA Seeds: `[b"nullifier", pool.key().as_ref(), nullifier_hash.as_ref()]`
#[account]
pub struct SpentNullifier {
    /// Reference to parent pool
    pub pool: Pubkey,

    /// The nullifier hash that was spent
    pub nullifier_hash: [u8; 32],

    /// Asset ID associated with this nullifier
    pub asset_id: [u8; 32],

    /// Type of operation that spent this nullifier
    pub spend_type: u8,

    /// Unix timestamp when nullifier was spent
    pub spent_at: i64,

    /// Slot number when nullifier was spent
    pub spent_slot: u64,

    /// Relayer that submitted the transaction (if any)
    pub relayer: Pubkey,

    /// PDA bump seed
    pub bump: u8,
}

impl SpentNullifier {
    pub const LEN: usize = 8  // discriminator
        + 32                  // pool
        + 32                  // nullifier_hash  
        + 32                  // asset_id
        + 1                   // spend_type
        + 8                   // spent_at
        + 8                   // spent_slot
        + 32                  // relayer
        + 1; // bump

    /// Initialize spent nullifier record
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        pool: Pubkey,
        nullifier_hash: [u8; 32],
        asset_id: [u8; 32],
        spend_type: SpendType,
        spent_at: i64,
        spent_slot: u64,
        relayer: Pubkey,
        bump: u8,
    ) {
        self.pool = pool;
        self.nullifier_hash = nullifier_hash;
        self.asset_id = asset_id;
        self.spend_type = spend_type as u8;
        self.spent_at = spent_at;
        self.spent_slot = spent_slot;
        self.relayer = relayer;
        self.bump = bump;
    }

    /// Get spend type
    pub fn get_spend_type(&self) -> Option<SpendType> {
        match self.spend_type {
            0 => Some(SpendType::Withdraw),
            1 => Some(SpendType::JoinSplit),
            2 => Some(SpendType::ShieldedAction),
            _ => None,
        }
    }
}

/// PDA helpers for SpentNullifier
impl SpentNullifier {
    pub const SEED_PREFIX: &'static [u8] = b"nullifier";

    /// Derive the PDA address for a nullifier
    pub fn find_pda(program_id: &Pubkey, pool: &Pubkey, nullifier_hash: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, pool.as_ref(), nullifier_hash.as_ref()],
            program_id,
        )
    }

    /// Get PDA seeds for signing (when bump is known)
    pub fn seeds<'a>(
        pool: &'a Pubkey,
        nullifier_hash: &'a [u8; 32],
        bump: &'a [u8; 1],
    ) -> [&'a [u8]; 4] {
        [
            Self::SEED_PREFIX,
            pool.as_ref(),
            nullifier_hash.as_ref(),
            bump,
        ]
    }
}

#[cfg(test)]
#[allow(clippy::assertions_on_constants)]
mod tests {
    use super::*;

    #[test]
    fn test_spend_type_conversion() {
        assert_eq!(SpendType::Withdraw as u8, 0);
        assert_eq!(SpendType::JoinSplit as u8, 1);
        assert_eq!(SpendType::ShieldedAction as u8, 2);
    }

    #[test]
    fn test_space() {
        assert!(SpentNullifier::LEN < 200);
    }
}
