//! Granular Pause Instructions - The White Protocol v2
//!
//! Provides fine-grained control over pool operations:
//! - pause_deposits: Stop new deposits while allowing withdrawals
//! - pause_withdrawals: Stop withdrawals while allowing deposits
//! - unpause_deposits: Resume deposits
//! - unpause_withdrawals: Resume withdrawals

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::{DepositsPausedV2, DepositsUnpausedV2, WithdrawalsPausedV2, WithdrawalsUnpausedV2};
use crate::state::PoolConfig;

// =============================================================================
// PAUSE DEPOSITS
// =============================================================================

/// Accounts for pausing deposits
#[derive(Accounts)]
pub struct PauseDepositsV2<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
        constraint = !pool_config.deposits_paused @ WhiteProtocolError::DepositsPaused,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for pause_deposits_v2 instruction
pub fn handler_pause_deposits(ctx: Context<PauseDepositsV2>) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    pool_config.set_deposits_paused(true);
    pool_config.last_activity_at = timestamp;

    emit!(DepositsPausedV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!("Deposits paused by authority");

    Ok(())
}

// =============================================================================
// UNPAUSE DEPOSITS
// =============================================================================

/// Accounts for unpausing deposits
#[derive(Accounts)]
pub struct UnpauseDepositsV2<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
        constraint = pool_config.deposits_paused @ WhiteProtocolError::InvalidInput,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for unpause_deposits_v2 instruction
pub fn handler_unpause_deposits(ctx: Context<UnpauseDepositsV2>) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    pool_config.set_deposits_paused(false);
    pool_config.last_activity_at = timestamp;

    emit!(DepositsUnpausedV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!("Deposits unpaused by authority");

    Ok(())
}

// =============================================================================
// PAUSE WITHDRAWALS
// =============================================================================

/// Accounts for pausing withdrawals
#[derive(Accounts)]
pub struct PauseWithdrawalsV2<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
        constraint = !pool_config.withdrawals_paused @ WhiteProtocolError::WithdrawalsPaused,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for pause_withdrawals_v2 instruction
pub fn handler_pause_withdrawals(ctx: Context<PauseWithdrawalsV2>) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    pool_config.set_withdrawals_paused(true);
    pool_config.last_activity_at = timestamp;

    emit!(WithdrawalsPausedV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!("Withdrawals paused by authority");

    Ok(())
}

// =============================================================================
// UNPAUSE WITHDRAWALS
// =============================================================================

/// Accounts for unpausing withdrawals
#[derive(Accounts)]
pub struct UnpauseWithdrawalsV2<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
        constraint = pool_config.withdrawals_paused @ WhiteProtocolError::InvalidInput,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Handler for unpause_withdrawals_v2 instruction
pub fn handler_unpause_withdrawals(ctx: Context<UnpauseWithdrawalsV2>) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    pool_config.set_withdrawals_paused(false);
    pool_config.last_activity_at = timestamp;

    emit!(WithdrawalsUnpausedV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!("Withdrawals unpaused by authority");

    Ok(())
}
