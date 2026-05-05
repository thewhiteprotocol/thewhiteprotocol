use crate::error::WhiteProtocolError;
use crate::events::BridgeAssetConfigured;
use crate::state::bridge_asset_config::BridgeAssetConfig;
use crate::state::bridge_v1_config::BridgeV1Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(canonical_asset_id: [u8; 32], supported: bool, max_message_amount: u128, daily_cap: u128)]
pub struct SetBridgeV1Asset<'info> {
    #[account(mut, constraint = bridge_v1_config.authority == authority.key() @ WhiteProtocolError::Unauthorized)]
    pub authority: Signer<'info>,

    pub bridge_v1_config: Account<'info, BridgeV1Config>,

    #[account(
        init_if_needed,
        payer = authority,
        space = BridgeAssetConfig::LEN,
        seeds = [BridgeAssetConfig::SEED_PREFIX, &canonical_asset_id],
        bump,
    )]
    pub asset_config: Account<'info, BridgeAssetConfig>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SetBridgeV1Asset>,
    canonical_asset_id: [u8; 32],
    supported: bool,
    max_message_amount: u128,
    daily_cap: u128,
) -> Result<()> {
    let asset = &mut ctx.accounts.asset_config;
    let clock = Clock::get()?;

    asset.canonical_asset_id = canonical_asset_id;
    asset.supported = supported;
    asset.max_message_amount = max_message_amount;
    asset.daily_cap = daily_cap;

    // Only reset counters on first init
    if asset.bump == 0 {
        asset.daily_used = 0;
        asset.daily_window_start = clock.unix_timestamp / 86400;
        asset.bump = ctx.bumps.asset_config;
    }

    emit!(BridgeAssetConfigured {
        canonical_asset_id,
        supported,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
