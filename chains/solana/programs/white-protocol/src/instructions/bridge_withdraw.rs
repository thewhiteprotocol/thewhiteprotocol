//! Bridge Withdraw Instruction - The White Protocol v2
//!
//! Withdraws tokens from the shielded pool for cross-chain bridging.
//!
//! # Security Model
//! 1. Bridge authority (typically a PDA from WhiteBridgeSolana) must sign
//! 2. Verifies ZK proof with bridge-specific public inputs
//! 3. `public_data_hash` is set to the bridge message hash (not zero)
//! 4. `recipient` is the bridge vault, `relayer` is default, `relayer_fee` is 0
//! 5. Nullifier is marked as spent

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::crypto::WithdrawPublicInputs;
use crate::error::WhiteProtocolError;
use crate::events::WithdrawMaspEvent;
use crate::state::{
    AssetVault, BridgeConfig, MerkleTree, PoolConfig, SpentNullifier, SpendType, VerificationKeyAccount,
};
use crate::utils::cu;
use crate::ProofType;

/// Accounts for bridge withdrawal
#[derive(Accounts)]
#[instruction(
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    nullifier_hash: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    asset_id: [u8; 32],
    public_data_hash: [u8; 32],
)]
pub struct BridgeWithdraw<'info> {
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

    /// Merkle tree account
    #[account(
        constraint = merkle_tree.is_known_root(&merkle_root) @ WhiteProtocolError::InvalidMerkleRoot,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    /// Verification key for withdraw proofs
    #[account(
        seeds = [ProofType::Withdraw.as_seed(), pool_config.key().as_ref()],
        bump = vk_account.bump,
        constraint = vk_account.is_initialized @ WhiteProtocolError::VerificationKeyNotSet,
        constraint = vk_account.proof_type == ProofType::Withdraw as u8
            @ WhiteProtocolError::InvalidVerificationKeyType,
    )]
    pub vk_account: Box<Account<'info, VerificationKeyAccount>>,

    /// Asset vault account
    #[account(
        mut,
        seeds = [
            AssetVault::SEED_PREFIX,
            pool_config.key().as_ref(),
            asset_id.as_ref(),
        ],
        bump = asset_vault.bump,
        constraint = asset_vault.is_active @ WhiteProtocolError::AssetNotActive,
        constraint = asset_vault.withdrawals_enabled @ WhiteProtocolError::WithdrawalsDisabled,
    )]
    pub asset_vault: Box<Account<'info, AssetVault>>,

    /// Vault's token account (source)
    #[account(
        mut,
        constraint = vault_token_account.key() == asset_vault.token_account
            @ WhiteProtocolError::InvalidVaultTokenAccount,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    /// Recipient's token account (destination) — typically the bridge vault
    #[account(
        mut,
        constraint = recipient_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = recipient_token_account.owner == recipient @ WhiteProtocolError::RecipientMismatch,
    )]
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    /// Spent nullifier account (PDA, created on first use)
    #[account(
        init,
        payer = bridge_authority,
        space = SpentNullifier::LEN,
        seeds = [
            SpentNullifier::SEED_PREFIX,
            pool_config.key().as_ref(),
            nullifier_hash.as_ref(),
        ],
        bump,
    )]
    pub spent_nullifier: Box<Account<'info, SpentNullifier>>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for bridge_withdraw instruction
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<BridgeWithdraw>,
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    nullifier_hash: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    asset_id: [u8; 32],
    public_data_hash: [u8; 32],
) -> Result<()> {
    // =========================================================================
    // INPUT VALIDATION
    // =========================================================================

    require!(proof_data.len() == 256, WhiteProtocolError::InvalidProofFormat);
    require!(amount > 0, WhiteProtocolError::InvalidAmount);
    require!(
        !nullifier_hash.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidNullifier
    );
    require!(
        !merkle_root.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidMerkleRoot
    );
    require!(
        asset_id == ctx.accounts.asset_vault.asset_id,
        WhiteProtocolError::AssetIdMismatch
    );
    require!(
        ctx.accounts.vault_token_account.amount >= amount,
        WhiteProtocolError::InsufficientBalance
    );

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;
    let slot = clock.slot;
    require!(timestamp > 0, WhiteProtocolError::InvalidTimestamp);

    // =========================================================================
    // PROOF VERIFICATION
    // =========================================================================
    cu("bridge_withdraw: before public_inputs");

    let public_inputs = WithdrawPublicInputs::new(
        merkle_root,
        nullifier_hash,
        asset_id,
        recipient,
        amount,
        Pubkey::default(), // relayer = default for bridge
        0,                 // relayer_fee = 0 for bridge
        public_data_hash,  // bridge message hash
    );
    public_inputs.validate()?;
    cu("bridge_withdraw: after public_inputs.validate");

    let field_elements = public_inputs.to_field_elements();
    let vk = &ctx.accounts.vk_account;
    let is_valid = crate::crypto::verify_proof_from_account(
        &vk.vk_alpha_g1,
        &vk.vk_beta_g2,
        &vk.vk_gamma_g2,
        &vk.vk_delta_g2,
        &vk.vk_ic,
        &proof_data,
        &field_elements,
    )?;
    cu("bridge_withdraw: after groth16 verify");

    require!(is_valid, WhiteProtocolError::InvalidProof);

    // =========================================================================
    // STATE CHANGES
    // =========================================================================

    ctx.accounts.spent_nullifier.initialize(
        ctx.accounts.pool_config.key(),
        nullifier_hash,
        asset_id,
        SpendType::Withdraw,
        timestamp,
        slot,
        ctx.accounts.bridge_authority.key(),
        ctx.bumps.spent_nullifier,
    );

    let pool_key = ctx.accounts.pool_config.key();
    let vault_bump = ctx.accounts.asset_vault.bump;
    let vault_seeds: &[&[u8]] = &[
        AssetVault::SEED_PREFIX,
        pool_key.as_ref(),
        asset_id.as_ref(),
        &[vault_bump],
    ];
    let vault_signer_seeds: &[&[&[u8]]] = &[vault_seeds];

    if amount > 0 {
        cu("bridge_withdraw: before token transfer");
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.asset_vault.to_account_info(),
            },
            vault_signer_seeds,
        );
        token::transfer(transfer_ctx, amount)?;
        cu("bridge_withdraw: after token transfer");
    }

    ctx.accounts.asset_vault.record_withdrawal(amount, timestamp)?;
    ctx.accounts.pool_config.record_withdrawal(timestamp)?;

    emit!(WithdrawMaspEvent {
        pool: ctx.accounts.pool_config.key(),
        nullifier_hash,
        asset_id,
        relayer: ctx.accounts.bridge_authority.key(),
        relayer_fee: 0,
        timestamp,
    });

    msg!("BridgeWithdraw: amount={}, asset={:?}, recipient={}", amount, asset_id, recipient);

    Ok(())
}
