use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::crypto::DepositPublicInputs;
use crate::error::WhiteProtocolError;
use crate::state::{
    AssetVault, MerkleTree, PendingDepositsBuffer, PoolConfig, VerificationKeyAccount,
};
use crate::utils::cu;
use crate::ProofType;

/// Accounts required for a MASP deposit.
#[derive(Accounts)]
#[instruction(
    amount: u64,
    commitment: [u8; 32],
    asset_id: [u8; 32],
    proof_data: Vec<u8>,
)]
pub struct DepositMasp<'info> {
    /// User funding the deposit and paying tx fees
    #[account(mut)]
    pub depositor: Signer<'info>,

    /// Global pool configuration
    #[account(
        mut,
        has_one = authority,
        has_one = merkle_tree,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    /// Pool authority (validated via has_one constraint)
    /// CHECK: Validated by has_one constraint on pool_config
    pub authority: UncheckedAccount<'info>,

    /// Merkle tree for commitments belonging to this pool
    #[account(
        mut,
        constraint = merkle_tree.pool == pool_config.key() @ WhiteProtocolError::InvalidMerkleTreePool
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    /// Pending deposits buffer (commitments queued for batching)
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

    /// Asset vault configuration for this asset
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

    /// Vault token account that receives deposited tokens
    #[account(
        mut,
        constraint = vault_token_account.key() == asset_vault.token_account
            @ WhiteProtocolError::InvalidVaultTokenAccount
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    /// User token account providing funds
    #[account(
        mut,
        constraint = user_token_account.mint == asset_vault.mint @ WhiteProtocolError::InvalidMint,
        constraint = user_token_account.owner == depositor.key() @ WhiteProtocolError::InvalidTokenOwner
    )]
    pub user_token_account: Account<'info, TokenAccount>,

    /// Mint for this asset
    #[account(
        constraint = mint.key() == asset_vault.mint @ WhiteProtocolError::InvalidMint
    )]
    pub mint: Account<'info, Mint>,

    /// Verification key account for the deposit circuit
    #[account(
        seeds = [ProofType::Deposit.as_seed(), pool_config.key().as_ref()],
        bump = deposit_vk.bump,
        constraint = deposit_vk.pool == pool_config.key() @ WhiteProtocolError::InvalidVerificationKeyPool,
        constraint = deposit_vk.proof_type == ProofType::Deposit as u8 @ WhiteProtocolError::InvalidVerificationKeyType,
        constraint = deposit_vk.is_initialized @ WhiteProtocolError::VerificationKeyNotSet,
    )]
    pub deposit_vk: Account<'info, VerificationKeyAccount>,

    /// SPL token program
    pub token_program: Program<'info, Token>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for deposit_masp instruction
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<DepositMasp>,
    amount: u64,
    commitment: [u8; 32],
    asset_id: [u8; 32],
    proof_data: Vec<u8>,
    _encrypted_note: Option<Vec<u8>>,
) -> Result<()> {
    // IMPORTANT:
    // - ctx.accounts.pool_config is Box<Account<PoolConfig>> so it has `.key()`
    // - after deref, PoolConfig itself does NOT have `.key()`
    let _pool_key = ctx.accounts.pool_config.key();

    // Deref Box<Account<...>> to inner mutable account data for updates.
    let pool_config: &mut PoolConfig = &mut *ctx.accounts.pool_config;
    let merkle_tree: &MerkleTree = &*ctx.accounts.merkle_tree;
    let pending_buffer: &mut PendingDepositsBuffer = &mut *ctx.accounts.pending_buffer;
    let asset_vault: &mut AssetVault = &mut *ctx.accounts.asset_vault;

    let timestamp = Clock::get()?.unix_timestamp;

    // =========================================================================
    // 1. INPUT VALIDATION
    // =========================================================================

    require!(amount > 0, WhiteProtocolError::InvalidAmount);
    cu("deposit: after amount>0");
    log_cu();

    require!(
        !commitment.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidCommitment
    );

    require!(proof_data.len() == 256, WhiteProtocolError::InvalidProofFormat);
    cu("deposit: after proof len");

    require!(
        asset_vault.asset_id == asset_id,
        WhiteProtocolError::AssetIdMismatch
    );

    require!(!merkle_tree.is_full(), WhiteProtocolError::MerkleTreeFull);

    // =========================================================================
    // 2. VERIFY GROTH16 PROOF
    // =========================================================================

    let public_inputs = DepositPublicInputs::new(commitment, amount, asset_id);
    public_inputs.validate()?;
    cu("deposit: after public_inputs.validate");
    let public_inputs_fields = public_inputs.to_field_elements();

    let vk = &ctx.accounts.deposit_vk;
    cu("deposit: before groth16 verify");
    let is_valid = crate::crypto::verify_proof_from_account(
        &vk.vk_alpha_g1,
        &vk.vk_beta_g2,
        &vk.vk_gamma_g2,
        &vk.vk_delta_g2,
        &vk.vk_ic,
        &proof_data,
        &public_inputs_fields,
    )?;
    require!(is_valid, WhiteProtocolError::InvalidProof);
    cu("deposit: after groth16 verify");
    log_cu();

    // =========================================================================
    // 3. TRANSFER TOKENS FROM USER TO VAULT
    // =========================================================================

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_token_account.to_account_info(),
        to: ctx.accounts.vault_token_account.to_account_info(),
        authority: ctx.accounts.depositor.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    cu("deposit: before token::transfer");
    token::transfer(cpi_ctx, amount)?;
    cu("deposit: after token::transfer");

    // =========================================================================
    // 4. QUEUE COMMITMENT FOR BATCHED MERKLE INSERTION
    // =========================================================================

    // Ensure the Merkle tree can eventually fit all pending + this new deposit
    let available = merkle_tree.available_space() as usize;
    let pending = pending_buffer.size();
    require!(available > pending, WhiteProtocolError::MerkleTreeFull);

    cu("deposit: before pending_buffer.add_pending");
    let pending_index = pending_buffer.add_pending(commitment, timestamp)?;
    cu("deposit: after pending_buffer.add_pending");
    let pending_count = pending_buffer.size();
    log_cu();

    // =========================================================================
    // 5. UPDATE STATISTICS
    // =========================================================================

    asset_vault.record_deposit(amount, timestamp)?;
    pool_config.record_deposit(timestamp)?;

    msg!(
        "MASP deposit queued: pending_index={}, pending_count={}",
        pending_index,
        pending_count
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_proof_data_length() {
        assert_eq!(256, 64 + 64 + 128);
    }
}

// --- Compute-unit instrumentation (syscall wrapper; compatible with older solana-program crates) ---
#[cfg(any(target_os = "solana", target_arch = "bpf"))]
#[inline(always)]
fn log_cu() {
    unsafe {
        sol_log_compute_units_();
    }
}

#[cfg(any(target_os = "solana", target_arch = "bpf"))]
extern "C" {
    fn sol_log_compute_units_();
}

// On native/unit tests, do nothing.
#[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
#[inline(always)]
fn log_cu() {}
