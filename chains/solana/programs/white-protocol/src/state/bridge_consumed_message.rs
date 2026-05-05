use anchor_lang::prelude::*;

/// Replay protection: marks a bridge message as already consumed on the destination chain.
/// PDA seeds: `["bridge_consumed", message_hash]`.
#[account]
pub struct ConsumedBridgeMessage {
    /// The message hash that was consumed.
    pub message_hash: [u8; 32],
    /// Source domain.
    pub source_domain: u32,
    /// Destination domain.
    pub destination_domain: u32,
    /// Nonce from the message.
    pub nonce: u64,
    /// Unix timestamp when consumed.
    pub consumed_at: i64,
    /// PDA bump seed.
    pub bump: u8,
}

impl ConsumedBridgeMessage {
    pub const SEED_PREFIX: &'static [u8] = b"bridge_consumed";
    /// 8 + 32 + 4 + 4 + 8 + 8 + 1 = 65 bytes
    pub const LEN: usize = 8 + 32 + 4 + 4 + 8 + 8 + 1;
}
