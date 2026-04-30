//! Chunked Verification Key Upload for The White Protocol v2
//!
//! Upload large verification keys in multiple transactions.
//! Flow:
//!   initialize_vk_v2 -> append_vk_ic_v2 (multiple) -> finalize_vk_v2
//!
//! State model (VerificationKeyAccount):
//! - is_initialized: VK is complete and usable
//! - is_locked: VK is immutable (cannot be modified anymore)

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::VerificationKeySetV2;
use crate::state::{PoolConfig, VerificationKeyAccount};
use crate::ProofType;

/// Initialize VK account with base data (alpha, beta, gamma, delta)
#[derive(Accounts)]
#[instruction(proof_type: ProofType)]
pub struct InitializeVkV2<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = VerificationKeyAccount::space(VerificationKeyAccount::DEFAULT_MAX_IC_POINTS),
        seeds = [proof_type.as_seed(), pool_config.key().as_ref()],
        bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    pub system_program: Program<'info, System>,
}

/// Initialize VK with base curve points (no IC yet)
pub fn initialize_vk_handler(
    ctx: Context<InitializeVkV2>,
    proof_type: ProofType,
    vk_alpha_g1: [u8; 64],
    vk_beta_g2: [u8; 128],
    vk_gamma_g2: [u8; 128],
    vk_delta_g2: [u8; 128],
    expected_ic_count: u8,
) -> Result<()> {
    let pool_config = &ctx.accounts.pool_config;
    let vk_account = &mut ctx.accounts.vk_account;

    // Pool-level policy gate
    pool_config.require_vk_unlocked(proof_type)?;

    // Account-level gates
    require!(
        !vk_account.is_locked,
        WhiteProtocolError::VerificationKeyLocked
    );
    require!(
        !vk_account.is_initialized,
        WhiteProtocolError::VkAlreadyFinalized
    );

    // Validate expected IC count for the proof type
    let required_ic = VerificationKeyAccount::expected_ic_points(proof_type);
    require!(
        expected_ic_count == required_ic,
        WhiteProtocolError::VkIcLengthMismatch
    );

    // Populate base VK fields
    vk_account.pool = pool_config.key();
    vk_account.proof_type = proof_type as u8;
    vk_account.vk_alpha_g1 = vk_alpha_g1;
    vk_account.vk_beta_g2 = vk_beta_g2;
    vk_account.vk_gamma_g2 = vk_gamma_g2;
    vk_account.vk_delta_g2 = vk_delta_g2;

    // Reset IC vector and lifecycle fields deterministically
    vk_account.vk_ic_len = expected_ic_count;
    vk_account.vk_ic = Vec::with_capacity(expected_ic_count as usize);

    vk_account.is_initialized = false;
    vk_account.is_locked = false;
    vk_account.set_at = 0;
    vk_account.locked_at = 0;
    vk_account.vk_hash = [0u8; 32];
    vk_account._reserved = [0u8; 32];

    vk_account.bump = ctx.bumps.vk_account;

    msg!(
        "Initialized VK for {:?}, expecting {} IC points",
        proof_type,
        expected_ic_count
    );

    Ok(())
}

/// Append IC points to VK account
#[derive(Accounts)]
#[instruction(proof_type: ProofType)]
pub struct AppendVkIcV2<'info> {
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    #[account(
        mut,
        seeds = [proof_type.as_seed(), pool_config.key().as_ref()],
        bump = vk_account.bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,
}

/// Append IC points (call multiple times for large VKs)
pub fn append_vk_ic_handler(
    ctx: Context<AppendVkIcV2>,
    _proof_type: ProofType,
    ic_points: Vec<[u8; 64]>,
) -> Result<()> {
    let vk_account = &mut ctx.accounts.vk_account;

    // Cannot mutate a locked VK
    require!(
        !vk_account.is_locked,
        WhiteProtocolError::VerificationKeyLocked
    );

    // Cannot append after finalization
    require!(
        !vk_account.is_initialized,
        WhiteProtocolError::VkAlreadyFinalized
    );

    // Check we won't exceed expected count
    let new_len = vk_account.vk_ic.len() + ic_points.len();
    require!(
        new_len <= vk_account.vk_ic_len as usize,
        WhiteProtocolError::VkIcLengthMismatch
    );

    // Append
    vk_account.vk_ic.extend(ic_points);

    msg!(
        "Appended IC points, now have {}/{}",
        vk_account.vk_ic.len(),
        vk_account.vk_ic_len
    );

    Ok(())
}

/// Finalize VK - marks it as ready for use
#[derive(Accounts)]
#[instruction(proof_type: ProofType)]
pub struct FinalizeVkV2<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    #[account(
        mut,
        seeds = [proof_type.as_seed(), pool_config.key().as_ref()],
        bump = vk_account.bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,
}

/// Finalize VK after all IC points are uploaded.
/// Also supports repairing legacy accounts that were initialized but not locked.
pub fn finalize_vk_handler(ctx: Context<FinalizeVkV2>, proof_type: ProofType) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;
    let vk_account = &mut ctx.accounts.vk_account;

    // Cannot touch a locked VK
    require!(
        !vk_account.is_locked,
        WhiteProtocolError::VerificationKeyLocked
    );

    // Must be complete before finalizing or locking
    require!(
        vk_account.vk_ic.len() == vk_account.vk_ic_len as usize,
        WhiteProtocolError::VkIcLengthMismatch
    );

    let timestamp = Clock::get()?.unix_timestamp;

    // Legacy repair path: already initialized (finalized earlier) but not locked.
    if vk_account.is_initialized {
        vk_account.is_locked = true;
        vk_account.locked_at = timestamp;

        msg!("Locked existing VK for {:?}", proof_type);
        return Ok(());
    }

    // Fresh finalize path
    vk_account.is_initialized = true;
    vk_account.set_at = timestamp;
    vk_account.vk_hash = vk_account.compute_vk_hash_internal();

    // Lock so it can’t be modified later
    vk_account.is_locked = true;
    vk_account.locked_at = timestamp;

    // Mark pool config as having this VK configured
    pool_config.set_vk_configured(proof_type);

    emit!(VerificationKeySetV2 {
        pool: pool_config.key(),
        proof_type: proof_type as u8,
        ic_length: vk_account.vk_ic_len,
        vk_hash: vk_account.vk_hash,
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!(
        "Finalized VK for {:?} with {} IC points",
        proof_type,
        vk_account.vk_ic_len
    );

    Ok(())
}

/// Close VK account - allows authority to delete and recreate a VK
#[derive(Accounts)]
#[instruction(proof_type: ProofType)]
pub struct CloseVkV2<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    #[account(
        mut,
        seeds = [proof_type.as_seed(), pool_config.key().as_ref()],
        bump = vk_account.bump,
        close = authority,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,
}

/// Handler for close_vk_v2 instruction
/// Allows pool authority to close a VK account to fix mistakes or update VKs
pub fn close_vk_handler(ctx: Context<CloseVkV2>, proof_type: ProofType) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;

    // Clear the VK configured flag
    let mask = 1u8 << (proof_type as u8);
    pool_config.vk_configured &= !mask;
    pool_config.vk_locked &= !mask;

    msg!("Closed VK for proof type {:?}", proof_type);

    Ok(())
}
