use crate::events::BridgeV1ConfigInitialized;
use crate::state::bridge_v1_config::BridgeV1Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitBridgeV1Config<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = BridgeV1Config::LEN,
        seeds = [BridgeV1Config::SEED_PREFIX],
        bump,
    )]
    pub bridge_v1_config: Account<'info, BridgeV1Config>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitBridgeV1Config>, domain_id: u32) -> Result<()> {
    let config = &mut ctx.accounts.bridge_v1_config;
    let clock = Clock::get()?;

    config.authority = ctx.accounts.authority.key();
    config.domain_id = domain_id;
    config.signer_set_version = 0;
    config.global_paused = false;
    config.bump = ctx.bumps.bridge_v1_config;
    config.created_at = clock.unix_timestamp;
    config.updated_at = clock.unix_timestamp;

    emit!(BridgeV1ConfigInitialized {
        authority: config.authority,
        domain_id,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
