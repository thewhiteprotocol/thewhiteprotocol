//! Update Relayer Instruction
//!
//! Updates relayer configuration including fee and metadata.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::RelayerUpdated;
use crate::state::{PoolConfig, RelayerNode, RelayerRegistry};

/// Accounts for updating a relayer
#[derive(Accounts)]
pub struct UpdateRelayer<'info> {
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
    ///
    /// Security: PDA seeds ensure this node belongs to relayer_registry.
    /// The `has_one = operator` ensures only the operator can update.
    /// No need for separate `has_one = registry` since seeds already bind it.
    #[account(
        mut,
        has_one = operator @ WhiteProtocolError::Unauthorized,
        seeds = [
            RelayerNode::SEED_PREFIX,
            relayer_registry.key().as_ref(),
            operator.key().as_ref(),
        ],
        bump = relayer_node.bump,
        // Additional safety: verify stored registry matches
        constraint = relayer_node.registry == relayer_registry.key()
            @ WhiteProtocolError::RelayerNodeRegistryMismatch,
    )]
    pub relayer_node: Account<'info, RelayerNode>,
    // REMOVED: Redundant `registry: UncheckedAccount`
    // The PDA seeds already bind relayer_node to relayer_registry
}

/// Handler for update_relayer instruction
pub fn handler(
    ctx: Context<UpdateRelayer>,
    fee_bps: Option<u16>,
    metadata_uri: Option<String>,
    is_active: Option<bool>,
) -> Result<()> {
    let registry = &mut ctx.accounts.relayer_registry;
    let relayer_node = &mut ctx.accounts.relayer_node;

    // If updating fee, validate it's within bounds
    if let Some(fee) = fee_bps {
        registry.validate_fee(fee)?;
    }

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Track if we're changing active status
    let was_active = relayer_node.is_active;
    let will_be_active = is_active.unwrap_or(was_active);

    // Update relayer node
    relayer_node.update(fee_bps, metadata_uri, is_active, timestamp)?;

    // Update registry counts if active status changed
    if was_active && !will_be_active {
        registry.deactivate_relayer(timestamp)?;
    } else if !was_active && will_be_active {
        registry.reactivate_relayer(timestamp)?;
    }

    // Emit event
    emit!(RelayerUpdated {
        pool: ctx.accounts.pool_config.key(),
        relayer: relayer_node.key(),
        operator: ctx.accounts.operator.key(),
        fee_bps: relayer_node.fee_bps,
        is_active: relayer_node.is_active,
        timestamp,
    });

    msg!(
        "Relayer updated: fee={} bps, active={}",
        relayer_node.fee_bps,
        relayer_node.is_active
    );

    Ok(())
}
