//! Authority Transfer V2 Instructions
//!
//! Implements a 2-step authority transfer process:
//! 1. Current authority initiates transfer to new authority
//! 2. New authority accepts the transfer
//! 3. Current authority can cancel pending transfer

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::{
    AuthorityTransferCancelledV2, AuthorityTransferCompletedV2, AuthorityTransferInitiatedV2,
};
use crate::state::PoolConfig;

// ============================================================================
// INITIATE TRANSFER
// ============================================================================

/// Accounts for initiating authority transfer
#[derive(Accounts)]
pub struct InitiateAuthorityTransferV2<'info> {
    /// Current pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for initiate_authority_transfer_v2 instruction
pub fn initiate_handler(
    ctx: Context<InitiateAuthorityTransferV2>,
    new_authority: Pubkey,
) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Initiate the transfer
    pool_config.initiate_authority_transfer(new_authority)?;
    pool_config.last_activity_at = timestamp;

    // Emit event
    emit!(AuthorityTransferInitiatedV2 {
        pool: pool_config.key(),
        current_authority: ctx.accounts.authority.key(),
        pending_authority: new_authority,
        timestamp,
    });

    msg!(
        "Authority transfer initiated: {} -> {}",
        ctx.accounts.authority.key(),
        new_authority
    );

    Ok(())
}

// ============================================================================
// ACCEPT TRANSFER
// ============================================================================

/// Accounts for accepting authority transfer
#[derive(Accounts)]
pub struct AcceptAuthorityTransferV2<'info> {
    /// New authority accepting the transfer (must be signer)
    pub new_authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        constraint = pool_config.pending_authority == new_authority.key() @ WhiteProtocolError::Unauthorized,
        constraint = pool_config.has_pending_transfer() @ WhiteProtocolError::NoPendingAuthority,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for accept_authority_transfer_v2 instruction
pub fn accept_handler(ctx: Context<AcceptAuthorityTransferV2>) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    let old_authority = pool_config.authority;

    // Accept the transfer
    pool_config.accept_authority_transfer(ctx.accounts.new_authority.key())?;
    pool_config.last_activity_at = timestamp;

    // Emit event
    emit!(AuthorityTransferCompletedV2 {
        pool: pool_config.key(),
        old_authority,
        new_authority: ctx.accounts.new_authority.key(),
        timestamp,
    });

    msg!(
        "Authority transfer completed: {} -> {}",
        old_authority,
        ctx.accounts.new_authority.key()
    );

    Ok(())
}

// ============================================================================
// CANCEL TRANSFER
// ============================================================================

/// Accounts for cancelling authority transfer
#[derive(Accounts)]
pub struct CancelAuthorityTransferV2<'info> {
    /// Current pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
        constraint = pool_config.has_pending_transfer() @ WhiteProtocolError::NoPendingAuthority,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for cancel_authority_transfer_v2 instruction
pub fn cancel_handler(ctx: Context<CancelAuthorityTransferV2>) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    let cancelled_pending = pool_config.pending_authority;

    // Cancel the transfer
    pool_config.cancel_authority_transfer();
    pool_config.last_activity_at = timestamp;

    // Emit event
    emit!(AuthorityTransferCancelledV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        cancelled_pending,
        timestamp,
    });

    msg!("Authority transfer cancelled");

    Ok(())
}
