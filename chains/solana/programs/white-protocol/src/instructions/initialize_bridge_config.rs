//! Initialize Bridge Config - The White Protocol v2
//!
//! Sets up the bridge authority for a pool. Only the pool authority can call this.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::state::{BridgeConfig, PoolConfig};

/// Accounts for initializing bridge config
#[derive(Accounts)]
pub struct InitializeBridgeConfig<'info> {
    /// Pool authority (must sign)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Pool configuration
    #[account(
        mut,
        has_one = authority,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    /// Bridge config account (PDA, created here)
    #[account(
        init,
        payer = authority,
        space = BridgeConfig::LEN,
        seeds = [BridgeConfig::SEED_PREFIX, pool_config.key().as_ref()],
        bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for initialize_bridge_config
pub fn handler(ctx: Context<InitializeBridgeConfig>, bridge_authority: Pubkey) -> Result<()> {
    require!(
        bridge_authority != Pubkey::default(),
        WhiteProtocolError::InvalidAddress
    );

    let bridge_config = &mut ctx.accounts.bridge_config;
    bridge_config.pool = ctx.accounts.pool_config.key();
    bridge_config.bridge_authority = bridge_authority;
    bridge_config.bump = ctx.bumps.bridge_config;

    msg!(
        "BridgeConfig initialized: pool={}, authority={}",
        bridge_config.pool,
        bridge_authority
    );

    Ok(())
}
