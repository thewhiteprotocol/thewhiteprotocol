use anchor_lang::prelude::*;

/// Commitment Index Account
///
/// PDA Seeds: `[b"commitment", pool_config.key().as_ref(), commitment]`
///
/// Acts as a singleton marker to prevent duplicate commitments from being
/// deposited into the pool. Created on first deposit of a commitment;
/// subsequent deposits with the same commitment will fail because the PDA
/// already exists.
#[account]
pub struct CommitmentIndex {
    /// The commitment hash this index tracks
    pub commitment: [u8; 32],

    /// PDA bump seed
    pub bump: u8,
}

impl CommitmentIndex {
    pub const LEN: usize = 8 + 32 + 1;
}
