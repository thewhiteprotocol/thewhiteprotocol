//! Unpause Pool V2 Instruction
//!
//! Unpauses the pool, re-enabling all operations.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::PoolUnpausedV2;
use crate::state::PoolConfig;

/// Accounts for unpausing the pool
#[derive(Accounts)]
pub struct UnpausePoolV2<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
        constraint = pool_config.is_paused @ WhiteProtocolError::PoolNotPaused,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for unpause_pool_v2 instruction
pub fn handler(ctx: Context<UnpausePoolV2>) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Unpause the pool
    pool_config.set_paused(false);
    pool_config.last_activity_at = timestamp;

    // Emit event
    emit!(PoolUnpausedV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!("Pool unpaused by authority");

    Ok(())
}
