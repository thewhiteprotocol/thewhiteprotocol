use crate::error::WhiteProtocolError;
use crate::events::BridgeGlobalPauseSet;
use crate::state::bridge_v1_config::BridgeV1Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetBridgeV1GlobalPause<'info> {
    #[account(constraint = bridge_v1_config.authority == authority.key() @ WhiteProtocolError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub bridge_v1_config: Account<'info, BridgeV1Config>,
}

pub fn handler(ctx: Context<SetBridgeV1GlobalPause>, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.bridge_v1_config;
    let clock = Clock::get()?;

    config.global_paused = paused;
    config.updated_at = clock.unix_timestamp;

    emit!(BridgeGlobalPauseSet {
        paused,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
