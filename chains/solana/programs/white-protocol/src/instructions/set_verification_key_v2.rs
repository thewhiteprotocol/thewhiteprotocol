//! Set Verification Key V2 Instruction
//!
//! Sets and locks verification keys for different proof types.
//! Each proof type (Deposit, Withdraw, JoinSplit, Membership) has its own VK account.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::{VerificationKeyLockedV2, VerificationKeySetV2};
use crate::state::{PoolConfig, VerificationKeyAccount};
use crate::ProofType;

/// Accounts for setting a verification key
#[derive(Accounts)]
#[instruction(proof_type: ProofType)]
pub struct SetVerificationKeyV2<'info> {
    /// Pool authority (must be signer)
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Verification key account (PDA based on proof type)
    #[account(
        init_if_needed,
        payer = authority,
        space = VerificationKeyAccount::space(VerificationKeyAccount::DEFAULT_MAX_IC_POINTS),
        seeds = [proof_type.as_seed(), pool_config.key().as_ref()],
        bump,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for set_verification_key_v2 instruction
#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<SetVerificationKeyV2>,
    proof_type: ProofType,
    vk_alpha_g1: [u8; 64],
    vk_beta_g2: [u8; 128],
    vk_gamma_g2: [u8; 128],
    vk_delta_g2: [u8; 128],
    vk_ic: Vec<[u8; 64]>,
) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;
    let vk_account = &mut ctx.accounts.vk_account;

    // SECURITY: Check VK is not locked in pool config
    pool_config.require_vk_unlocked(proof_type)?;

    // SECURITY: Defense-in-depth - also check the VK account's own lock flag
    // This catches cases where pool_config and vk_account get out of sync
    if vk_account.is_initialized {
        require!(
            !vk_account.is_locked,
            WhiteProtocolError::VerificationKeyLocked
        );
    }

    // Validate IC length matches expected for proof type
    let expected_ic = VerificationKeyAccount::expected_ic_points(proof_type);
    require!(
        vk_ic.len() as u8 == expected_ic,
        WhiteProtocolError::VkIcLengthMismatch
    );

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Initialize if needed
    if !vk_account.is_initialized {
        vk_account.initialize(pool_config.key(), proof_type, ctx.bumps.vk_account);
    }

    // Set VK data
    vk_account.set_vk(
        vk_alpha_g1,
        vk_beta_g2,
        vk_gamma_g2,
        vk_delta_g2,
        vk_ic.clone(),
        timestamp,
    );

    // Mark VK as configured in pool config
    pool_config.set_vk_configured(proof_type);

    // Emit event
    emit!(VerificationKeySetV2 {
        pool: pool_config.key(),
        proof_type: proof_type as u8,
        ic_length: vk_ic.len() as u8,
        vk_hash: vk_account.vk_hash,
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!(
        "Set VK for proof type {:?}: {} IC points",
        proof_type,
        vk_ic.len()
    );

    Ok(())
}

/// Accounts for locking a verification key
#[derive(Accounts)]
#[instruction(proof_type: ProofType)]
pub struct LockVerificationKeyV2<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        mut,
        has_one = authority @ WhiteProtocolError::Unauthorized,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Verification key account
    #[account(
        mut,
        seeds = [proof_type.as_seed(), pool_config.key().as_ref()],
        bump = vk_account.bump,
        constraint = vk_account.is_initialized @ WhiteProtocolError::VerificationKeyNotSet,
    )]
    pub vk_account: Account<'info, VerificationKeyAccount>,
}

/// Handler for lock_verification_key_v2 instruction
pub fn lock_handler(ctx: Context<LockVerificationKeyV2>, proof_type: ProofType) -> Result<()> {
    let pool_config = &mut ctx.accounts.pool_config;
    let vk_account = &mut ctx.accounts.vk_account;

    // Check not already locked
    require!(
        !vk_account.is_locked,
        WhiteProtocolError::VerificationKeyLocked
    );

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Lock the VK
    vk_account.lock(timestamp);
    pool_config.lock_vk(proof_type);

    // Emit event
    emit!(VerificationKeyLockedV2 {
        pool: pool_config.key(),
        proof_type: proof_type as u8,
        authority: ctx.accounts.authority.key(),
        timestamp,
    });

    msg!("Locked VK for proof type {:?}", proof_type);

    Ok(())
}
