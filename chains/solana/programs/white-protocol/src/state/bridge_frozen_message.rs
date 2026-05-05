use anchor_lang::prelude::*;

/// Message freeze status for challenge/watcher path.
/// PDA seeds: `["bridge_frozen", message_hash]`.
#[account]
pub struct FrozenBridgeMessage {
    /// The message hash that is frozen.
    pub message_hash: [u8; 32],
    /// True if frozen, false if un-frozen.
    pub frozen: bool,
    /// Unix timestamp when frozen status was last set.
    pub frozen_at: i64,
    /// PDA bump seed.
    pub bump: u8,
}

impl FrozenBridgeMessage {
    pub const SEED_PREFIX: &'static [u8] = b"bridge_frozen";
    /// 8 + 32 + 1 + 8 + 1 = 50 bytes
    pub const LEN: usize = 8 + 32 + 1 + 8 + 1;
}
