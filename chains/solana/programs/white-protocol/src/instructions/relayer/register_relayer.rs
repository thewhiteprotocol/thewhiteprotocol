//! Register Relayer Instruction
//!
//! Registers a new relayer node with the pool.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::RelayerRegistered;
use crate::state::{PoolConfig, RelayerNode, RelayerRegistry, MAX_RELAYER_METADATA_URI_LEN};

/// Accounts for registering a new relayer
#[derive(Accounts)]
pub struct RegisterRelayer<'info> {
    /// Relayer operator (owner of the relayer node)
    #[account(mut)]
    pub operator: Signer<'info>,

    /// Pool configuration account
    #[account(
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
        has_one = relayer_registry,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Relayer registry account
    #[account(mut)]
    pub relayer_registry: Account<'info, RelayerRegistry>,

    /// Relayer node account (PDA)
    #[account(
        init,
        payer = operator,
        space = RelayerNode::DEFAULT_SPACE,
        seeds = [
            RelayerNode::SEED_PREFIX,
            relayer_registry.key().as_ref(),
            operator.key().as_ref(),
        ],
        bump,
    )]
    pub relayer_node: Account<'info, RelayerNode>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for register_relayer instruction
pub fn handler(ctx: Context<RegisterRelayer>, fee_bps: u16, metadata_uri: String) -> Result<()> {
    let registry = &mut ctx.accounts.relayer_registry;
    let relayer_node = &mut ctx.accounts.relayer_node;

    // Validate metadata URI length
    require!(
        metadata_uri.len() <= MAX_RELAYER_METADATA_URI_LEN,
        WhiteProtocolError::InputTooLarge
    );

    // Validate fee is within bounds
    registry.validate_fee(fee_bps)?;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Register with registry
    registry.register_relayer(timestamp)?;

    // Initialize relayer node
    relayer_node.initialize(
        registry.key(),
        ctx.accounts.operator.key(),
        fee_bps,
        metadata_uri,
        ctx.bumps.relayer_node,
        timestamp,
    );

    // Emit event
    emit!(RelayerRegistered {
        pool: ctx.accounts.pool_config.key(),
        registry: registry.key(),
        relayer: relayer_node.key(),
        operator: ctx.accounts.operator.key(),
        fee_bps,
        timestamp,
    });

    msg!(
        "Relayer registered: operator={}, fee={} bps",
        ctx.accounts.operator.key(),
        fee_bps
    );

    Ok(())
}
