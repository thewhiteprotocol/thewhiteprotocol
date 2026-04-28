//! Bridge Mint Instruction - The White Protocol v2
//!
//! Mints (deposits) a commitment into the shielded pool on behalf of the bridge.
//! Called when a cross-chain message arrives from another chain.
//!
//! # Security Model
//! 1. Bridge authority must sign
//! 2. No ZK proof required — trust assumption: bridge has already verified
//!    the source-chain burn/nullifier on the originating chain
//! 3. Transfers tokens from bridge token account into pool vault
//! 4. Queues commitment for batch Merkle insertion

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::error::WhiteProtocolError;
use crate::events::DepositQueuedEvent;
use crate::state::{
    AssetVault, BridgeConfig, CommitmentIndex, MerkleTree, PendingDepositsBuffer, PoolConfig,
};
use crate::utils::cu;

/// Accounts for bridge mint (inbound bridged deposit)
#[derive(Accounts)]
#[instruction(
    amount: u64,
    commitment: [u8; 32],
    asset_id: [u8; 32],
)]
pub struct BridgeMint<'info> {
    /// Bridge authority — must be the configured bridge authority
    #[account(
        mut,
        constraint = bridge_authority.key() == bridge_config.bridge_authority @ WhiteProtocolError::Unauthorized,
    )]
    pub bridge_authority: Signer<'info>,

    /// Bridge configuration
    #[account(
        seeds = [BridgeConfig::SEED_PREFIX, pool_config.key().as_ref()],
        bump = bridge_config.bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    /// Pool configuration
    #[account(
        mut,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
        has_one = merkle_tree,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    /// Merkle tree for commitments
    #[account(
        mut,
        constraint = merkle_tree.pool == pool_config.key() @ WhiteProtocolError::InvalidMerkleTreePool
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    /// Pending deposits buffer
    #[account(
        mut,
        seeds = [
            PendingDepositsBuffer::SEED_PREFIX,
            pool_config.key().as_ref(),
        ],
        bump = pending_buffer.bump,
        constraint = pending_buffer.pool == pool_config.key() @ WhiteProtocolError::InvalidPoolReference,
    )]
    pub pending_buffer: Box<Account<'info, PendingDepositsBuffer>>,

    /// Asset vault
    #[account(
        mut,
        seeds = [
            AssetVault::SEED_PREFIX,
            pool_config.key().as_ref(),
            asset_id.as_ref(),
        ],
        bump = asset_vault.bump,
        constraint = asset_vault.pool == pool_config.key() @ WhiteProtocolError::InvalidVaultPool,
        constraint = asset_vault.is_active @ WhiteProtocolError::AssetNotActive,
        constraint = asset_vault.deposits_enabled @ WhiteProtocolError::DepositsDisabled,
    )]
    pub asset_vault: Box<Account<'info, AssetVault>>,

    /// Pool vault token account (receives tokens)
    #[account(
        mut,
        constraint = vault_token_account.key() == asset_vault.token_account
            @ WhiteProtocolError::InvalidVaultTokenAccount
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    /// Bridge token account (source of tokens)
    #[account(
        mut,
        constraint = bridge_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = bridge_token_account.owner == bridge_authority.key() @ WhiteProtocolError::InvalidTokenOwner
    )]
    pub bridge_token_account: Box<Account<'info, TokenAccount>>,

    /// Mint for this asset
    #[account(
        constraint = mint.key() == asset_vault.mint @ WhiteProtocolError::InvalidMint
    )]
    pub mint: Box<Account<'info, Mint>>,

    /// Commitment index (prevents duplicates)
    #[account(
        init,
        payer = bridge_authority,
        space = CommitmentIndex::LEN,
        seeds = [b"commitment", pool_config.key().as_ref(), commitment.as_ref()],
        bump,
    )]
    pub commitment_index: Account<'info, CommitmentIndex>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for bridge_mint instruction
pub fn handler(
    ctx: Context<BridgeMint>,
    amount: u64,
    commitment: [u8; 32],
    asset_id: [u8; 32],
) -> Result<()> {
    let _pool_config: &mut PoolConfig = &mut *ctx.accounts.pool_config;
    let merkle_tree: &MerkleTree = &*ctx.accounts.merkle_tree;
    let pending_buffer: &mut PendingDepositsBuffer = &mut *ctx.accounts.pending_buffer;
    let asset_vault: &mut AssetVault = &mut *ctx.accounts.asset_vault;

    let timestamp = Clock::get()?.unix_timestamp;
    cu("bridge_mint: start");

    // =========================================================================
    // INPUT VALIDATION
    // =========================================================================

    require!(amount > 0, WhiteProtocolError::InvalidAmount);
    require!(
        !commitment.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidCommitment
    );
    require!(
        asset_vault.asset_id == asset_id,
        WhiteProtocolError::AssetIdMismatch
    );
    asset_vault.validate_deposit_amount(amount)?;
    require!(!merkle_tree.is_full(), WhiteProtocolError::MerkleTreeFull);

    // =========================================================================
    // TRANSFER TOKENS FROM BRIDGE TO POOL VAULT
    // =========================================================================
    cu("bridge_mint: before token transfer");

    let cpi_accounts = Transfer {
        from: ctx.accounts.bridge_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.bridge_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;
    cu("bridge_mint: after token transfer");

    // =========================================================================
    // QUEUE COMMITMENT FOR BATCHED MERKLE INSERTION
    // =========================================================================

    let available = merkle_tree.available_space() as usize;
    let pending = pending_buffer.size();
    require!(available > pending, WhiteProtocolError::MerkleTreeFull);

    for deposit in &pending_buffer.deposits {
        require!(
            deposit.commitment != commitment,
            WhiteProtocolError::CommitmentAlreadyExists
        );
    }

    let pending_index = pending_buffer.add_pending(commitment, timestamp)?;
    cu("bridge_mint: after pending_buffer.add_pending");
    let pending_count = pending_buffer.size();

    // =========================================================================
    // UPDATE STATISTICS
    // =========================================================================

    ctx.accounts.commitment_index.commitment = commitment;
    ctx.accounts.commitment_index.bump = ctx.bumps.commitment_index;

    asset_vault.record_deposit(amount, timestamp)?;

    emit!(DepositQueuedEvent {
        pool: ctx.accounts.pool_config.key(),
        commitment,
        asset_id,
        timestamp,
    });

    msg!(
        "BridgeMint: commitment queued, pending_index={}, pending_count={}",
        pending_index,
        pending_count
    );

    Ok(())
}
