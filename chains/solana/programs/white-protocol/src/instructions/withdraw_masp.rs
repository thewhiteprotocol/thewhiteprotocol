//! Withdraw MASP Instruction - The White Protocol v2
//!
//! Withdraws tokens from the shielded pool using a ZK proof.
//!
//! # Privacy Considerations
//!
//! The withdrawal event intentionally does NOT include:
//! - recipient (visible in tx accounts, but not easily indexed from events)
//! - amount (prevents amount correlation attacks)
//!
//! While this data is technically visible in transaction accounts (required
//! for token delivery), omitting it from events makes large-scale indexing
//! and correlation significantly harder.
//!
//! # Security Model
//!
//! 1. User generates ZK proof proving:
//!    - Knowledge of commitment preimage (secret, nullifier, amount, asset_id)
//!    - Commitment exists in Merkle tree at known root
//!    - Nullifier is correctly derived from secret + leaf_index
//! 2. Nullifier is marked as spent (prevents double-spending)
//! 3. Tokens are transferred to recipient
//! 4. Relayer receives fee for submitting transaction

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::crypto::WithdrawPublicInputs;
use crate::error::WhiteProtocolError;
#[cfg(feature = "event-debug")]
use crate::events::WithdrawMaspDebugEvent;
use crate::events::WithdrawMaspEvent;
use crate::state::{
    AssetVault, MerkleTree, PoolConfig, RelayerNode, RelayerRegistry, SpendType,
    SpentNullifier, VerificationKeyAccount, YieldRegistry,
};
use crate::ProofType;

/// Minimum withdrawal amount to prevent dust attacks
pub const MIN_WITHDRAWAL_AMOUNT: u64 = 100;

/// Maximum relayer fee in basis points (10% = 1000 bps)
pub const MAX_RELAYER_FEE_BPS: u64 = 1000;

/// Accounts for withdrawing from the MASP
#[derive(Accounts)]
#[instruction(
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    nullifier_hash: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    asset_id: [u8; 32],
    relayer_fee: u64,
)]
pub struct WithdrawMasp<'info> {
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

    /// Recipient's token account (destination)
    /// SECURITY: Must be owned by the recipient pubkey from the proof public inputs
    /// to prevent fund redirection attacks.
    #[account(
        mut,
        constraint = recipient_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = recipient_token_account.owner == recipient @ WhiteProtocolError::RecipientMismatch,
    )]
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    /// Relayer's token account for fee (if relayer_fee > 0)
    /// SECURITY: Must be owned by the relayer signer to prevent fee redirection attacks.
    #[account(
        mut,
        constraint = relayer_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = relayer_token_account.owner == relayer.key() @ WhiteProtocolError::RelayerMismatch,
    )]
    pub relayer_token_account: Box<Account<'info, TokenAccount>>,

    /// Spent nullifier account (PDA, created on first use)
    #[account(
        init,
        payer = relayer,
        space = SpentNullifier::LEN,
        seeds = [
            SpentNullifier::SEED_PREFIX,
            pool_config.key().as_ref(),
            nullifier_hash.as_ref(),
        ],
        bump,
    )]
    pub spent_nullifier: Box<Account<'info, SpentNullifier>>,

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

/// Handler for withdraw_masp instruction
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<WithdrawMasp>,
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    nullifier_hash: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    asset_id: [u8; 32],
    relayer_fee: u64,
) -> Result<()> {
    // =========================================================================
    // INPUT VALIDATION (fail fast before any state changes)
    // =========================================================================

    // Validate proof data length (Groth16: 2*G1 + 1*G2 = 256 bytes)
    require!(proof_data.len() == 256, WhiteProtocolError::InvalidProofFormat);

    // Validate amount is above minimum (prevents dust attacks)
    require!(
        amount >= MIN_WITHDRAWAL_AMOUNT,
        WhiteProtocolError::InvalidAmount
    );

    // Validate nullifier is not zero
    require!(
        !nullifier_hash.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidNullifier
    );

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

    // Validate relayer fee is reasonable (max 10% for safety)
    // Using multiplication to avoid integer division edge cases:
    // relayer_fee <= amount * 10% is equivalent to relayer_fee * 10 <= amount
    // This correctly handles small amounts where amount/10 would truncate to 0
    //
    // SECURITY: Use checked_mul to reject overflow instead of silent saturation
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
        // Validate RelayerNode belongs to the expected RelayerRegistry and is the canonical PDA
        // derived from seeds [b"relayer", registry, operator].
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
        // Validate fee matches registered relayer's rate
        let expected_fee = relayer_node.calculate_fee(amount)?;
        require!(
            relayer_fee <= expected_fee,
            WhiteProtocolError::RelayerFeeOutOfRange
        );
    }

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;
    let slot = clock.slot;

    // Validate timestamp is sane
    require!(timestamp > 0, WhiteProtocolError::InvalidTimestamp);

    // =========================================================================
    // PROOF VERIFICATION (before any state changes)
    // =========================================================================

    // Construct public inputs for proof verification
    // Must match withdraw.circom public signal order:
    // merkle_root, nullifier_hash, asset_id, recipient, amount, relayer, relayer_fee, public_data_hash
    let public_inputs = WithdrawPublicInputs::new(
        merkle_root,
        nullifier_hash,
        asset_id,
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

    // Mark nullifier as spent (this is atomic with account creation)
    // If the nullifier was already spent, account creation would have failed
    ctx.accounts.spent_nullifier.initialize(
        ctx.accounts.pool_config.key(),
        nullifier_hash,
        asset_id,
        SpendType::Withdraw,
        timestamp,
        slot,
        ctx.accounts.relayer.key(),
        ctx.bumps.spent_nullifier,
    );

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

    let vault_signer_seeds: &[&[&[u8]]] = &[vault_seeds];

    // Transfer tokens to recipient
    if recipient_amount > 0 {
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.asset_vault.to_account_info(),
            },
            vault_signer_seeds,
        );
        token::transfer(transfer_ctx, recipient_amount)?;
    }

    // Transfer fee to relayer
    if relayer_fee > 0 {
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.relayer_token_account.to_account_info(),
                authority: ctx.accounts.asset_vault.to_account_info(),
            },
            vault_signer_seeds,
        );
        token::transfer(transfer_ctx, relayer_fee)?;
    }

    // Update asset vault statistics
    ctx.accounts
        .asset_vault
        .record_withdrawal(amount, timestamp)?;

    // Update pool statistics
    ctx.accounts.pool_config.record_withdrawal(timestamp)?;

    // Update relayer statistics if registered
    if let Some(relayer_node) = ctx.accounts.relayer_node.as_mut() {
        relayer_node.record_transaction(relayer_fee, timestamp)?;
    }

    // =========================================================================
    // EMIT PRIVACY-PRESERVING EVENT
    // =========================================================================

    // Emit minimal, privacy-preserving withdraw event.
    // Does NOT include recipient or amount to prevent easy indexing/correlation.
    //
    // While recipient and amount ARE visible in transaction accounts (required
    // for token delivery), omitting them from events makes large-scale
    // correlation significantly harder - events are the primary data source
    // for most indexing infrastructure.
    emit!(WithdrawMaspEvent {
        pool: ctx.accounts.pool_config.key(),
        nullifier_hash,
        asset_id,
        relayer: ctx.accounts.relayer.key(),
        relayer_fee,
        timestamp,
    });

    // Debug event - only emitted when event-debug feature is enabled
    // WARNING: MUST NOT be enabled in mainnet builds
    #[cfg(feature = "event-debug")]
    {
        emit!(WithdrawMaspDebugEvent {
            pool: ctx.accounts.pool_config.key(),
            nullifier_hash,
            recipient,
            amount,
            asset_id,
            relayer: ctx.accounts.relayer.key(),
            relayer_fee,
            timestamp,
        });

        msg!(
            "MASP withdrawal (debug): amount={}, recipient={}, fee={}",
            amount,
            recipient,
            relayer_fee
        );
    }

    Ok(())
}

// ============================================================================
// STEALTH WITHDRAWAL VARIANT
// ============================================================================

use crate::events::StealthWithdrawal;

#[derive(Accounts)]
#[instruction(
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    nullifier_hash: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    asset_id: [u8; 32],
    relayer_fee: u64,
    ephemeral_pubkey: [u8; 32],
)]
pub struct WithdrawMaspStealth<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,

    #[account(
        mut,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
        has_one = merkle_tree,
        has_one = relayer_registry,
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    #[account(
        constraint = merkle_tree.is_known_root(&merkle_root) @ WhiteProtocolError::InvalidMerkleRoot,
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    #[account(
        seeds = [ProofType::Withdraw.as_seed(), pool_config.key().as_ref()],
        bump = vk_account.bump,
        constraint = vk_account.is_initialized @ WhiteProtocolError::VerificationKeyNotSet,
        constraint = vk_account.proof_type == ProofType::Withdraw as u8
            @ WhiteProtocolError::InvalidVerificationKeyType,
    )]
    pub vk_account: Box<Account<'info, VerificationKeyAccount>>,

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

    #[account(
        mut,
        constraint = vault_token_account.key() == asset_vault.token_account
            @ WhiteProtocolError::InvalidVaultTokenAccount,
    )]
    pub vault_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = recipient_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = recipient_token_account.owner == recipient @ WhiteProtocolError::RecipientMismatch,
    )]
    pub recipient_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = relayer_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = relayer_token_account.owner == relayer.key() @ WhiteProtocolError::RelayerMismatch,
    )]
    pub relayer_token_account: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = relayer,
        space = SpentNullifier::LEN,
        seeds = [
            SpentNullifier::SEED_PREFIX,
            pool_config.key().as_ref(),
            nullifier_hash.as_ref(),
        ],
        bump,
    )]
    pub spent_nullifier: Box<Account<'info, SpentNullifier>>,

    pub relayer_registry: Box<Account<'info, RelayerRegistry>>,

    pub relayer_node: Option<Box<Account<'info, RelayerNode>>>,

    pub yield_registry: Option<Box<Account<'info, YieldRegistry>>>,

    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler_stealth(
    ctx: Context<WithdrawMaspStealth>,
    proof_data: Vec<u8>,
    merkle_root: [u8; 32],
    nullifier_hash: [u8; 32],
    recipient: Pubkey,
    amount: u64,
    asset_id: [u8; 32],
    relayer_fee: u64,
    ephemeral_pubkey: [u8; 32],
) -> Result<()> {
    // NOTE: This is a mirror of `handler` above with the addition of the
    // StealthWithdrawal event. Both functions must stay in sync.

    // Input validation
    require!(proof_data.len() == 256, WhiteProtocolError::InvalidProofFormat);
    require!(amount >= MIN_WITHDRAWAL_AMOUNT, WhiteProtocolError::InvalidAmount);
    require!(!nullifier_hash.iter().all(|&b| b == 0), WhiteProtocolError::InvalidNullifier);
    require!(!merkle_root.iter().all(|&b| b == 0), WhiteProtocolError::InvalidMerkleRoot);
    require!(!ephemeral_pubkey.iter().all(|&b| b == 0), WhiteProtocolError::InvalidEphemeralPubkey);
    require!(relayer_fee <= amount, WhiteProtocolError::RelayerFeeExceedsAmount);

    let fee_times_ten = relayer_fee
        .checked_mul(10)
        .ok_or(error!(WhiteProtocolError::RelayerFeeOverflow))?;
    require!(fee_times_ten <= amount, WhiteProtocolError::RelayerFeeOutOfRange);
    require!(asset_id == ctx.accounts.asset_vault.asset_id, WhiteProtocolError::AssetIdMismatch);

    if ctx.accounts.pool_config.is_yield_enforcement_enabled() {
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

    require!(
        ctx.accounts.vault_token_account.amount >= amount,
        WhiteProtocolError::InsufficientBalance
    );

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

    let public_inputs = WithdrawPublicInputs::new(
        merkle_root,
        nullifier_hash,
        asset_id,
        recipient,
        amount,
        ctx.accounts.relayer.key(),
        relayer_fee,
        [0u8; 32],
    );
    public_inputs.validate()?;

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

    ctx.accounts.spent_nullifier.initialize(
        ctx.accounts.pool_config.key(),
        nullifier_hash,
        asset_id,
        SpendType::Withdraw,
        timestamp,
        slot,
        ctx.accounts.relayer.key(),
        ctx.bumps.spent_nullifier,
    );

    let recipient_amount = amount
        .checked_sub(relayer_fee)
        .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

    let pool_key = ctx.accounts.pool_config.key();
    let vault_bump = ctx.accounts.asset_vault.bump;
    let vault_seeds: &[&[u8]] = &[
        AssetVault::SEED_PREFIX,
        pool_key.as_ref(),
        asset_id.as_ref(),
        &[vault_bump],
    ];
    let vault_signer_seeds: &[&[&[u8]]] = &[vault_seeds];

    if recipient_amount > 0 {
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.asset_vault.to_account_info(),
            },
            vault_signer_seeds,
        );
        token::transfer(transfer_ctx, recipient_amount)?;
    }

    if relayer_fee > 0 {
        let transfer_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_token_account.to_account_info(),
                to: ctx.accounts.relayer_token_account.to_account_info(),
                authority: ctx.accounts.asset_vault.to_account_info(),
            },
            vault_signer_seeds,
        );
        token::transfer(transfer_ctx, relayer_fee)?;
    }

    ctx.accounts
        .asset_vault
        .record_withdrawal(amount, timestamp)?;
    ctx.accounts.pool_config.record_withdrawal(timestamp)?;

    if let Some(relayer_node) = ctx.accounts.relayer_node.as_mut() {
        relayer_node.record_transaction(relayer_fee, timestamp)?;
    }

    emit!(WithdrawMaspEvent {
        pool: ctx.accounts.pool_config.key(),
        nullifier_hash,
        asset_id,
        relayer: ctx.accounts.relayer.key(),
        relayer_fee,
        timestamp,
    });

    emit!(StealthWithdrawal {
        ephemeral_pubkey,
        destination: recipient,
        slot,
    });

    #[cfg(feature = "event-debug")]
    {
        emit!(WithdrawMaspDebugEvent {
            pool: ctx.accounts.pool_config.key(),
            nullifier_hash,
            recipient,
            amount,
            asset_id,
            relayer: ctx.accounts.relayer.key(),
            relayer_fee,
            timestamp,
        });
        msg!(
            "MASP stealth withdrawal (debug): amount={}, recipient={}, fee={}",
            amount,
            recipient,
            relayer_fee
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_relayer_fee_validation_small_amounts() {
        // Test that small amounts can still have relayer fees
        // amount = 100, max fee should be 10 (10%)
        let amount: u64 = 100;
        let relayer_fee: u64 = 10;
        let fee_times_ten = relayer_fee.checked_mul(10).unwrap();
        assert!(fee_times_ten <= amount); // 100 <= 100 ✓

        // amount = 15, max fee should be 1 (not 0!)
        let amount: u64 = 15;
        let relayer_fee: u64 = 1;
        let fee_times_ten = relayer_fee.checked_mul(10).unwrap();
        assert!(fee_times_ten <= amount); // 10 <= 15 ✓

        // amount = 5, max fee should be 0
        let amount: u64 = 5;
        let relayer_fee: u64 = 0;
        let fee_times_ten = relayer_fee.checked_mul(10).unwrap();
        assert!(fee_times_ten <= amount); // 0 <= 5 ✓

        // Reject excessive fee
        let amount: u64 = 100;
        let relayer_fee: u64 = 11;
        let fee_times_ten = relayer_fee.checked_mul(10).unwrap();
        assert!(!(fee_times_ten <= amount)); // 110 > 100 ✗
    }

    #[test]
    fn test_relayer_fee_overflow_rejected() {
        // This fee would overflow when multiplied by 10
        let relayer_fee: u64 = u64::MAX / 5;
        let amount: u64 = u64::MAX;

        // With saturating_mul, this would incorrectly PASS (security bug)
        // saturating_mul(relayer_fee, 10) = u64::MAX <= amount ✓
        assert!(relayer_fee.saturating_mul(10) <= amount);

        // With checked_mul, this correctly detects overflow and returns None
        assert!(relayer_fee.checked_mul(10).is_none());
    }

    #[test]
    fn test_min_withdrawal_amount() {
        assert_eq!(MIN_WITHDRAWAL_AMOUNT, 100);
    }
}
