//! Denomination Configuration Instruction - The White Protocol v2
//!
//! Configures allowed withdrawal amounts to improve privacy.
//!
//! # Privacy Rationale
//!
//! Variable withdrawal amounts enable correlation attacks:
//! - Deposit 1.234 SOL → Withdraw 1.234 SOL = obviously linked
//!
//! Fixed denominations force all withdrawals to be from a set of allowed amounts:
//! - Deposit 1.234 SOL → Must withdraw 1 SOL + 0.1 SOL + 0.1 SOL (3 transactions)
//! - All 1 SOL withdrawals are indistinguishable from each other
//!
//! # Configuration
//!
//! Admin can configure up to 8 denominations, e.g.:
//! - [0.1, 0.5, 1, 5, 10, 50, 100, 500] SOL
//!
//! Or disable denomination enforcement for maximum flexibility.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::DenominationsConfiguredV2;
use crate::state::{PoolConfig, MAX_DENOMINATIONS};

/// Accounts for configuring denominations
#[derive(Accounts)]
pub struct ConfigureDenominationsV2<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,
}

/// Configure allowed denominations
///
/// # Arguments
/// * `denominations` - Array of 8 allowed amounts (0 = unused slot)
/// * `enforce` - Whether to enforce denominations on withdrawals
///
/// # Example
/// ```ignore
/// // Configure SOL denominations (in lamports)
/// let denominations = [
///     100_000_000,      // 0.1 SOL
///     500_000_000,      // 0.5 SOL
///     1_000_000_000,    // 1 SOL
///     5_000_000_000,    // 5 SOL
///     10_000_000_000,   // 10 SOL
///     50_000_000_000,   // 50 SOL
///     100_000_000_000,  // 100 SOL
///     0,                // unused
/// ];
/// configure_denominations(denominations, true);
/// ```
pub fn handler_configure_denominations(
    ctx: Context<ConfigureDenominationsV2>,
    denominations: [u64; MAX_DENOMINATIONS],
    enforce: bool,
) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Configure denominations (validates internally)
    pool_config.configure_denominations(denominations, enforce)?;
    pool_config.last_activity_at = timestamp;

    emit!(DenominationsConfiguredV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        denominations,
        enforce,
        timestamp,
    });

    msg!(
        "Denominations configured: {} active, enforce={}",
        pool_config.denomination_count,
        enforce
    );

    Ok(())
}

/// Set default denominations (recommended for SOL)
///
/// Sets the following denominations (in lamports):
/// - 0.1, 0.5, 1, 5, 10, 50, 100, 500 SOL
pub fn handler_set_default_denominations(
    ctx: Context<ConfigureDenominationsV2>,
) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    pool_config.set_default_denominations();
    pool_config.last_activity_at = timestamp;

    emit!(DenominationsConfiguredV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        denominations: pool_config.denominations,
        enforce: true,
        timestamp,
    });

    msg!("Default denominations set and enforced");

    Ok(())
}

/// Disable denomination enforcement
///
/// Allows arbitrary withdrawal amounts. Use with caution as this
/// reduces privacy guarantees.
pub fn handler_disable_denominations(
    ctx: Context<ConfigureDenominationsV2>,
) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    pool_config.enforce_denominations = false;
    pool_config.feature_flags &= !PoolConfig::FEATURE_DENOMINATIONS;
    pool_config.last_activity_at = timestamp;

    emit!(DenominationsConfiguredV2 {
        pool: pool_config.key(),
        authority: ctx.accounts.authority.key(),
        denominations: pool_config.denominations,
        enforce: false,
        timestamp,
    });

    msg!("Denomination enforcement disabled - privacy reduced!");

    Ok(())
}
