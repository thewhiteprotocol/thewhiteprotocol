//! Initialize Pending Deposits Buffer
//!
//! Creates the PendingDepositsBuffer PDA for a pool.
//! This is needed for batching Merkle insertions to avoid CU exhaustion.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::state::{PendingDepositsBuffer, PoolConfig};

#[derive(Accounts)]
pub struct InitializePendingDepositsBuffer<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [PoolConfig::SEED_PREFIX, authority.key().as_ref()],
        bump = pool_config.bump,
        has_one = authority @ WhiteProtocolError::InvalidAuthority,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    #[account(
        init,
        payer = authority,
        space = PendingDepositsBuffer::LEN,
        seeds = [
            PendingDepositsBuffer::SEED_PREFIX,
            pool_config.key().as_ref(),
        ],
        bump
    )]
    pub pending_buffer: Box<Account<'info, PendingDepositsBuffer>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePendingDepositsBuffer>) -> Result<()> {
    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    let bump = ctx.bumps.pending_buffer;
    ctx.accounts
        .pending_buffer
        .initialize(ctx.accounts.pool_config.key(), bump, timestamp);

    msg!(
        "Initialized PendingDepositsBuffer for pool: {} (bump={})",
        ctx.accounts.pool_config.key(),
        bump
    );

    Ok(())
}
