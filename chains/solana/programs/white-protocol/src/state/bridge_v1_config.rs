use anchor_lang::prelude::*;

/// Global bridge v1 configuration.
/// Single instance per program, PDA seeds: `["bridge_v1_config"]`.
#[account]
pub struct BridgeV1Config {
    /// Authority that can manage signer sets, routes, assets, pause, freeze.
    pub authority: Pubkey,
    /// Local domain ID for this chain.
    pub domain_id: u32,
    /// Current active signer set version.
    pub signer_set_version: u32,
    /// Global pause flag — stops ALL bridge activity when true.
    pub global_paused: bool,
    /// PDA bump seed.
    pub bump: u8,
    /// Unix timestamp when config was created.
    pub created_at: i64,
    /// Unix timestamp when config was last updated.
    pub updated_at: i64,
}

impl BridgeV1Config {
    pub const SEED_PREFIX: &'static [u8] = b"bridge_v1_config";
    /// 8 (discriminator) + 32 (Pubkey) + 4 + 4 + 1 + 1 + 8 + 8 = 66 bytes
    pub const LEN: usize = 8 + 32 + 4 + 4 + 1 + 1 + 8 + 8;
}
