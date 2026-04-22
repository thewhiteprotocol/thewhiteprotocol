//! Clear Pending Buffer Instruction
//!
//! Emergency admin function to clear pending deposits buffer.
use anchor_lang::prelude::*;
use crate::error::WhiteProtocolError;
use crate::state::{PoolConfig, PendingDepositsBuffer};

#[derive(Accounts)]
pub struct ClearPendingBuffer<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Pending deposits buffer
    #[account(
        mut,
        seeds = [
            PendingDepositsBuffer::SEED_PREFIX,
            pool_config.key().as_ref(),
        ],
        bump = pending_buffer.bump,
        constraint = pending_buffer.pool == pool_config.key() @ WhiteProtocolError::InvalidPoolReference,
    )]
    pub pending_buffer: Account<'info, PendingDepositsBuffer>,
}

pub fn handler(ctx: Context<ClearPendingBuffer>) -> Result<()> {
    let pending = &mut ctx.accounts.pending_buffer;
    let count = pending.total_pending;
    pending.deposits.clear();
    pending.total_pending = 0;
    msg!("Cleared {} pending deposits", count);
    Ok(())
}
