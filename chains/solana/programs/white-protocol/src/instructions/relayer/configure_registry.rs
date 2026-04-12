//! Configure Relayer Registry Instruction
//!
//! Configures global relayer parameters including fee bounds and staking requirements.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::RelayerRegistryConfigured;
use crate::state::{PoolConfig, RelayerRegistry};

/// Accounts for configuring the relayer registry
#[derive(Accounts)]
pub struct ConfigureRelayerRegistry<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        has_one = authority @ WhiteProtocolError::Unauthorized,
        has_one = relayer_registry,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Relayer registry account
    #[account(mut)]
    pub relayer_registry: Account<'info, RelayerRegistry>,
}

/// Handler for configure_relayer_registry instruction
pub fn handler(
    ctx: Context<ConfigureRelayerRegistry>,
    min_fee_bps: u16,
    max_fee_bps: u16,
    require_stake: bool,
    min_stake_amount: u64,
) -> Result<()> {
    let registry = &mut ctx.accounts.relayer_registry;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Configure the registry
    registry.configure(
        min_fee_bps,
        max_fee_bps,
        require_stake,
        min_stake_amount,
        timestamp,
    )?;

    // Emit event
    emit!(RelayerRegistryConfigured {
        pool: ctx.accounts.pool_config.key(),
        registry: registry.key(),
        min_fee_bps,
        max_fee_bps,
        require_stake,
        min_stake_amount,
        timestamp,
    });

    msg!(
        "Relayer registry configured: fee range {}..{} bps, stake: {} (min: {})",
        min_fee_bps,
        max_fee_bps,
        require_stake,
        min_stake_amount
    );

    Ok(())
}
