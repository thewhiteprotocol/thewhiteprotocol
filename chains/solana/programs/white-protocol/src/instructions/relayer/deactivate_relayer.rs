//! Deactivate Relayer Instruction
//!
//! Deactivates a relayer node. Can be reactivated later via update_relayer.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::RelayerDeactivated;
use crate::state::{PoolConfig, RelayerNode, RelayerRegistry};

/// Accounts for deactivating a relayer
#[derive(Accounts)]
pub struct DeactivateRelayer<'info> {
    /// Relayer operator (must be signer)
    pub operator: Signer<'info>,

    /// Pool configuration account
    #[account(
        has_one = relayer_registry,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Relayer registry account
    #[account(mut)]
    pub relayer_registry: Account<'info, RelayerRegistry>,

    /// Relayer node account
    #[account(
        mut,
        has_one = operator @ WhiteProtocolError::Unauthorized,
        constraint = relayer_node.is_active @ WhiteProtocolError::RelayerNotActive,
        seeds = [
            RelayerNode::SEED_PREFIX,
            relayer_registry.key().as_ref(),
            operator.key().as_ref(),
        ],
        bump = relayer_node.bump,
    )]
    pub relayer_node: Account<'info, RelayerNode>,
}

/// Handler for deactivate_relayer instruction
pub fn handler(ctx: Context<DeactivateRelayer>) -> Result<()> {
    let registry = &mut ctx.accounts.relayer_registry;
    let relayer_node = &mut ctx.accounts.relayer_node;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Deactivate the relayer
    relayer_node.deactivate(timestamp);
    registry.deactivate_relayer(timestamp)?;

    // Emit event
    emit!(RelayerDeactivated {
        pool: ctx.accounts.pool_config.key(),
        relayer: relayer_node.key(),
        operator: ctx.accounts.operator.key(),
        timestamp,
    });

    msg!("Relayer deactivated: {}", relayer_node.key());

    Ok(())
}
