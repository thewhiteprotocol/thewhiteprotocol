//! Withdraw V2 Instruction - The White Protocol v2 (Join-Split with Change)
//!
//! Withdraws tokens from the shielded pool with a change output.
//! This enables partial withdrawals from a single deposit.
//!
//! # Key Differences from WithdrawMasp (V1)
//!
//! - Uses WithdrawV2PublicInputs (12 inputs vs 8)
//! - Supports optional second nullifier (for 2-input join-split)
//! - Outputs change commitment to pending buffer
//! - Explicit schema versioning (schema_version = 2)

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::crypto::WithdrawV2PublicInputs;
use crate::error::WhiteProtocolError;
use crate::events::WithdrawV2Event;
use crate::state::{
    AssetVault, MerkleTree, PendingDepositsBuffer, PoolConfig, RelayerNode, RelayerRegistry,
    SpendType, SpentNullifier, VerificationKeyAccount, YieldRegistry,
};
use crate::ProofType;

/// Minimum withdrawal amount to prevent dust attacks
pub const MIN_WITHDRAWAL_AMOUNT: u64 = 100;

/// Maximum relayer fee in basis points (10% = 1000 bps)
pub const MAX_RELAYER_FEE_BPS: u64 = 1000;

/// Accounts for withdrawing from the MASP with change output
#[derive(Accounts)]
#[instruction(
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    asset_id: [u8; 32],
    nullifier_hash_0: [u8; 32],
    nullifier_hash_1: [u8; 32],
    change_commitment: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    relayer_fee: u64,
)]
pub struct WithdrawV2<'info> {
    /// Relayer submitting the transaction (pays gas, receives fee)
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
        has_one = merkle_tree,
        has_one = relayer_registry,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    /// Merkle tree account
    #[account(
        constraint = merkle_tree.is_known_root(&merkle_root) @ WhiteProtocolError::InvalidMerkleRoot,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    /// Verification key for withdraw v2 proofs
    #[account(
        seeds = [ProofType::WithdrawV2.as_seed(), pool_config.key().as_ref()],
        bump = vk_account.bump,
        constraint = vk_account.is_initialized @ WhiteProtocolError::VerificationKeyNotSet,
        constraint = vk_account.proof_type == ProofType::WithdrawV2 as u8
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

    /// Recipient's token account (destination)
    #[account(
        mut,
        constraint = recipient_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = recipient_token_account.owner == recipient @ WhiteProtocolError::RecipientMismatch,
    )]
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    /// Relayer's token account for fee
    #[account(
        mut,
        constraint = relayer_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = relayer_token_account.owner == relayer.key() @ WhiteProtocolError::RelayerMismatch,
    )]
    pub relayer_token_account: Box<Account<'info, TokenAccount>>,

    /// Primary spent nullifier account (PDA, created on first use)
    #[account(
        init,
        payer = relayer,
        space = SpentNullifier::LEN,
        seeds = [
            SpentNullifier::SEED_PREFIX,
            pool_config.key().as_ref(),
            nullifier_hash_0.as_ref(),
        ],
        bump,
    )]
    pub spent_nullifier_0: Box<Account<'info, SpentNullifier>>,

    /// Secondary spent nullifier account (optional, for 2-input join-split)
    /// If nullifier_hash_1 is all zeros, this account should not be provided
    pub spent_nullifier_1: Option<Box<Account<'info, SpentNullifier>>>,

    /// Pending deposits buffer (for change commitment)
    #[account(
        mut,
        seeds = [
            PendingDepositsBuffer::SEED_PREFIX,
            pool_config.key().as_ref(),
        ],
        bump,
    )]
    pub pending_buffer: Box<Account<'info, PendingDepositsBuffer>>,

    /// Relayer registry
    pub relayer_registry: Box<Account<'info, RelayerRegistry>>,

    /// Relayer node (optional, for registered relayers)
    pub relayer_node: Option<Box<Account<'info, RelayerNode>>>,

    /// Optional: Yield registry (for yield asset enforcement)
    pub yield_registry: Option<Box<Account<'info, YieldRegistry>>>,

    /// Token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for withdraw_v2 instruction
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<WithdrawV2>,
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    asset_id: [u8; 32],
    nullifier_hash_0: [u8; 32],
    nullifier_hash_1: [u8; 32],
    change_commitment: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    relayer_fee: u64,
) -> Result<()> {
    // =========================================================================
    // INPUT VALIDATION (fail fast before any state changes)
    // =========================================================================

    // Validate proof data length (Groth16: 2*G1 + 1*G2 = 256 bytes)
    require!(proof_data.len() == 256, WhiteProtocolError::InvalidProofFormat);

    // Validate amount is above minimum
    require!(
        amount >= MIN_WITHDRAWAL_AMOUNT,
        WhiteProtocolError::InvalidAmount
    );

    // Validate primary nullifier is not zero
    require!(
        !nullifier_hash_0.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidNullifier
    );

    // Validate change commitment is not zero
    require!(
        !change_commitment.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidCommitment
    );

    // Check if second nullifier is used
    let has_second_nullifier = !nullifier_hash_1.iter().all(|&b| b == 0);

    // If second nullifier is provided, validate it
    if has_second_nullifier {
        // Nullifiers must be different
        require!(
            nullifier_hash_1 != nullifier_hash_0,
            WhiteProtocolError::DuplicateNullifier
        );

        // spent_nullifier_1 account must be provided
        require!(
            ctx.accounts.spent_nullifier_1.is_some(),
            WhiteProtocolError::MissingAccount
        );
    }

    // Validate merkle root is not zero
    require!(
        !merkle_root.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidMerkleRoot
    );

    // Validate relayer fee doesn't exceed amount
    require!(
        relayer_fee <= amount,
        WhiteProtocolError::RelayerFeeExceedsAmount
    );

    // Validate relayer fee is reasonable (max 10%)
    let fee_times_ten = relayer_fee
        .checked_mul(10)
        .ok_or(error!(WhiteProtocolError::RelayerFeeOverflow))?;
    require!(
        fee_times_ten <= amount,
        WhiteProtocolError::RelayerFeeOutOfRange
    );

    // Validate asset ID matches
    require!(
        asset_id == ctx.accounts.asset_vault.asset_id,
        WhiteProtocolError::AssetIdMismatch
    );

    // =========================================================================
    // YIELD ENFORCEMENT: Reject yield assets in permissionless withdraw
    // =========================================================================
    if ctx.accounts.pool_config.is_yield_enforcement_enabled() {
        // CRITICAL: Require yield_registry when enforcement enabled
        let yield_registry = ctx
            .accounts
            .yield_registry
            .as_ref()
            .ok_or(WhiteProtocolError::YieldRegistryRequired)?;

        require!(
            !yield_registry.is_yield_asset(&asset_id),
            WhiteProtocolError::YieldAssetRequiresYieldExit
        );
    }

    // Validate sufficient vault balance
    require!(
        ctx.accounts.vault_token_account.amount >= amount,
        WhiteProtocolError::InsufficientBalance
    );

    // Validate relayer if registered
    if let Some(ref relayer_node) = ctx.accounts.relayer_node {
        let relayer_node_key = relayer_node.key();
        relayer_node.validate_registry_and_pda(
            ctx.program_id,
            &ctx.accounts.relayer_registry.key(),
            &relayer_node_key,
        )?;

        require!(relayer_node.is_active, WhiteProtocolError::RelayerNotActive);
        require!(
            relayer_node.operator == ctx.accounts.relayer.key(),
            WhiteProtocolError::Unauthorized
        );

        let expected_fee = relayer_node.calculate_fee(amount)?;
        require!(
            relayer_fee <= expected_fee,
            WhiteProtocolError::RelayerFeeOutOfRange
        );
    }

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;
    let slot = clock.slot;

    require!(timestamp > 0, WhiteProtocolError::InvalidTimestamp);

    // =========================================================================
    // PROOF VERIFICATION (before any state changes)
    // =========================================================================

    // Construct public inputs for proof verification
    let public_inputs = WithdrawV2PublicInputs::new(
        merkle_root,
        asset_id,
        nullifier_hash_0,
        nullifier_hash_1,
        change_commitment,
        recipient,
        amount,
        ctx.accounts.relayer.key(),
        relayer_fee,
        [0u8; 32], // public_data_hash (reserved for future use)
    );
    public_inputs.validate()?;

    // Verify the ZK proof
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

    require!(is_valid, WhiteProtocolError::InvalidProof);

    // =========================================================================
    // STATE CHANGES (only after proof verification succeeds)
    // =========================================================================

    // Mark primary nullifier as spent
    ctx.accounts.spent_nullifier_0.initialize(
        ctx.accounts.pool_config.key(),
        nullifier_hash_0,
        asset_id,
        SpendType::Withdraw,
        timestamp,
        slot,
        ctx.accounts.relayer.key(),
        ctx.bumps.spent_nullifier_0,
    );

    // Mark secondary nullifier as spent if provided
    if has_second_nullifier {
        if let Some(ref mut spent_null_1) = ctx.accounts.spent_nullifier_1 {
            spent_null_1.initialize(
                ctx.accounts.pool_config.key(),
                nullifier_hash_1,
                asset_id,
                SpendType::Withdraw,
                timestamp,
                slot,
                ctx.accounts.relayer.key(),
                0, // bump not available for optional accounts
            );
        }
    }

    // Add change commitment to pending buffer

    ctx.accounts
        .pending_buffer
        .add_pending(change_commitment, timestamp)?;

    // Calculate recipient amount after relayer fee
    let recipient_amount = amount
        .checked_sub(relayer_fee)
        .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

    // Create vault signer seeds for CPI
    let pool_key = ctx.accounts.pool_config.key();
    let vault_bump = ctx.accounts.asset_vault.bump;
    let vault_seeds: &[&[u8]] = &[
        AssetVault::SEED_PREFIX,
        pool_key.as_ref(),
        asset_id.as_ref(),
        &[vault_bump],
    ];
    let signer_seeds = &[&vault_seeds[..]];

    // Transfer to recipient
    if recipient_amount > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.recipient_token_account.to_account_info(),
            authority: ctx.accounts.asset_vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, recipient_amount)?;
    }

    // Transfer fee to relayer
    if relayer_fee > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.relayer_token_account.to_account_info(),
            authority: ctx.accounts.asset_vault.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);
        token::transfer(cpi_ctx, relayer_fee)?;
    }

    // Update statistics
    ctx.accounts.pool_config.total_withdrawals += 1;

    // Emit event
    emit!(WithdrawV2Event {
        pool: ctx.accounts.pool_config.key(),
        asset_id,
        nullifier_hash_0,
        nullifier_hash_1,
        change_commitment,
        merkle_root,
        timestamp,
        slot,
    });

    Ok(())
}
