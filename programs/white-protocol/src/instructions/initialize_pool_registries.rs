//! Initialize Pool Registries Instruction (Part 2)
//!
//! Creates relayer registry and compliance config.
//! Must be called after initialize_pool_v2.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::state::{ComplianceConfig, PoolConfig, RelayerRegistry};

#[derive(Accounts)]
pub struct InitializePoolRegistries<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [PoolConfig::SEED_PREFIX, authority.key().as_ref()],
        bump = pool_config.bump,
        has_one = authority @ WhiteProtocolError::InvalidAuthority,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    #[account(
        init,
        payer = authority,
        space = RelayerRegistry::LEN,
        seeds = [RelayerRegistry::SEED_PREFIX, pool_config.key().as_ref()],
        bump,
    )]
    pub relayer_registry: Box<Account<'info, RelayerRegistry>>,

    #[account(
        init,
        payer = authority,
        space = ComplianceConfig::LEN,
        seeds = [ComplianceConfig::SEED_PREFIX, pool_config.key().as_ref()],
        bump,
    )]
    pub compliance_config: Box<Account<'info, ComplianceConfig>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitializePoolRegistries>) -> Result<()> {
    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    let registry_bump = ctx.bumps.relayer_registry;
    let compliance_bump = ctx.bumps.compliance_config;

    // Update pool config with registry addresses
    ctx.accounts.pool_config.set_registries(
        ctx.accounts.relayer_registry.key(),
        ctx.accounts.compliance_config.key(),
        ctx.accounts.authority.key(), // Default yield_relayer to authority
    );

    // Initialize relayer registry
    ctx.accounts.relayer_registry.initialize(
        ctx.accounts.pool_config.key(),
        registry_bump,
        timestamp,
    );

    // Initialize compliance config
    ctx.accounts.compliance_config.initialize(
        ctx.accounts.pool_config.key(),
        compliance_bump,
        timestamp,
    );

    msg!(
        "Initialized The White Protocol v2 registries for pool: {}",
        ctx.accounts.pool_config.key()
    );

    Ok(())
}
