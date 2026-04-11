//! Initialize Yield Registry Instruction
//!
//! Creates a YieldRegistry PDA for a pool. The registry tracks which mints
//! are yield-bearing (LSTs) and must use withdraw_yield_v2 with fee enforcement.
//!
//! Security: pool_config is validated via has_one = authority (signer required).
//! YieldRegistry remains a PDA derived from pool_config.key() for uniqueness.

use crate::error::WhiteProtocolError;
use crate::state::{PoolConfig, YieldRegistry};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitYieldRegistry<'info> {
    /// Pool authority - must be signer
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Pool config - validated via has_one (no PDA seeds constraint)
    /// This supports both PDA and keypair-based pool configs
    #[account(
        has_one = authority @ WhiteProtocolError::InvalidAuthority,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Yield registry - PDA derived from pool_config key
    /// Ensures one registry per pool, regardless of pool_config type
    #[account(
        init,
        payer = authority,
        space = YieldRegistry::LEN,
        seeds = [YieldRegistry::SEED_PREFIX, pool_config.key().as_ref()],
        bump,
    )]
    pub yield_registry: Account<'info, YieldRegistry>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitYieldRegistry>) -> Result<()> {
    // Double-check authority matches (belt and suspenders)
    require!(
        ctx.accounts.pool_config.authority == ctx.accounts.authority.key(),
        WhiteProtocolError::InvalidAuthority
    );

    // Initialize registry with pool linkage
    ctx.accounts.yield_registry.initialize(
        ctx.accounts.pool_config.key(),
        ctx.accounts.authority.key(),
        ctx.bumps.yield_registry,
    );

    msg!(
        "Yield registry initialized for pool {}",
        ctx.accounts.pool_config.key()
    );
    Ok(())
}
