//! Initialize Pool Registries V2 Instruction (Part 2)
//!
//! Creates relayer_registry + compliance_config PDAs for an existing pool.

use anchor_lang::prelude::*;

use crate::state::{ComplianceConfig, PoolConfig, RelayerRegistry};

#[derive(Accounts)]
pub struct InitializePoolRegistriesV2<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority
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

pub fn handler(_ctx: Context<InitializePoolRegistriesV2>) -> Result<()> {
    Ok(())
}
