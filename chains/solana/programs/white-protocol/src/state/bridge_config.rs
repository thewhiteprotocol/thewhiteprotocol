use anchor_lang::prelude::*;

/// Bridge configuration for cross-chain bridging.
///
/// Stores the bridge authority (typically a PDA from the WhiteBridgeSolana program)
/// that is allowed to call `bridge_withdraw` and `bridge_mint`.
#[account]
pub struct BridgeConfig {
    /// Reference to parent pool
    pub pool: Pubkey,
    /// Bridge authority — must sign bridge instructions
    pub bridge_authority: Pubkey,
    /// PDA bump seed
    pub bump: u8,
}

impl BridgeConfig {
    pub const SEED_PREFIX: &'static [u8] = b"bridge_config";
    pub const LEN: usize = 8 + 32 + 32 + 1;
}
