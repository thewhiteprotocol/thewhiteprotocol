//! Initialize Pool V2 Instruction (Part 1)
//!
//! Creates pool config and Merkle tree.
//! Call initialize_pool_registries after this.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::PoolInitializedV2;
use crate::state::{
    ComplianceConfig, MerkleTree, PoolConfig, RelayerRegistry, MAX_TREE_DEPTH,
    MIN_ROOT_HISTORY_SIZE, MIN_TREE_DEPTH,
};

#[derive(Accounts)]
#[instruction(tree_depth: u8, root_history_size: u16)]
pub struct InitializePoolV2<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = PoolConfig::LEN,
        seeds = [PoolConfig::SEED_PREFIX, authority.key().as_ref()],
        bump,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    #[account(
        init,
        payer = authority,
        space = MerkleTree::space(tree_depth, root_history_size),
        seeds = [MerkleTree::SEED_PREFIX, pool_config.key().as_ref()],
        bump,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializePoolV2>,
    tree_depth: u8,
    root_history_size: u16,
) -> Result<()> {
    require!(
        tree_depth >= MIN_TREE_DEPTH && tree_depth <= MAX_TREE_DEPTH,
        WhiteProtocolError::InvalidTreeDepth
    );

    require!(
        root_history_size >= MIN_ROOT_HISTORY_SIZE,
        WhiteProtocolError::InvalidRootHistorySize
    );

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;
    let pool_bump = ctx.bumps.pool_config;

    // Derive registry addresses (will be created in Part 2)
    let (relayer_registry, _) = Pubkey::find_program_address(
        &[
            RelayerRegistry::SEED_PREFIX,
            ctx.accounts.pool_config.key().as_ref(),
        ],
        ctx.program_id,
    );

    let (_compliance_config, _) = Pubkey::find_program_address(
        &[
            ComplianceConfig::SEED_PREFIX,
            ctx.accounts.pool_config.key().as_ref(),
        ],
        ctx.program_id,
    );

    // Initialize pool config
    ctx.accounts.pool_config.initialize_partial(
        ctx.accounts.authority.key(),
        ctx.accounts.merkle_tree.key(),
        tree_depth,
        pool_bump,
        timestamp,
    );

    // Initialize Merkle tree
    ctx.accounts.merkle_tree.initialize(
        ctx.accounts.pool_config.key(),
        tree_depth,
        root_history_size,
    )?;

    emit!(PoolInitializedV2 {
        pool: ctx.accounts.pool_config.key(),
        authority: ctx.accounts.authority.key(),
        merkle_tree: ctx.accounts.merkle_tree.key(),
        relayer_registry,
        tree_depth,
        root_history_size,
        timestamp,
    });

    msg!(
        "Initialized The White Protocol v2 pool (part 1): depth={}, history_size={}",
        tree_depth,
        root_history_size
    );

    Ok(())
}
