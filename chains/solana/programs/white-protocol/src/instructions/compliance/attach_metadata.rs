//! Attach Audit Metadata Instruction
//!
//! Attaches encrypted audit metadata to an existing commitment.
/// Used for compliance and regulatory reporting.
use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::AuditMetadataAttached;
use crate::state::{AuditMetadata, ComplianceConfig, PoolConfig, MAX_ENCRYPTED_METADATA_LEN};

/// Accounts for attaching audit metadata
#[derive(Accounts)]
#[instruction(commitment: [u8; 32], encrypted_metadata: Vec<u8>)]
pub struct AttachAuditMetadata<'info> {
    /// Payer for the metadata account
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Pool configuration account
    #[account(
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused,
        has_one = compliance_config,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Compliance configuration account
    #[account(
        mut,
        constraint = compliance_config.audit_enabled @ WhiteProtocolError::FeatureDisabled,
    )]
    pub compliance_config: Account<'info, ComplianceConfig>,

    /// Audit metadata account (PDA)
    #[account(
        init,
        payer = payer,
        space = AuditMetadata::space(encrypted_metadata.len()),
        seeds = [
            AuditMetadata::SEED_PREFIX,
            pool_config.key().as_ref(),
            commitment.as_ref(),
        ],
        bump,
    )]
    pub audit_metadata: Account<'info, AuditMetadata>,

    /// System program
    pub system_program: Program<'info, System>,
}

/// Handler for attach_audit_metadata instruction
pub fn handler(
    ctx: Context<AttachAuditMetadata>,
    commitment: [u8; 32],
    encrypted_metadata: Vec<u8>,
) -> Result<()> {
    // Validate metadata length
    require!(
        encrypted_metadata.len() <= MAX_ENCRYPTED_METADATA_LEN,
        WhiteProtocolError::InputTooLarge
    );

    // Validate commitment is not zero
    require!(
        !commitment.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidCommitment
    );

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    let schema_version = ctx.accounts.compliance_config.metadata_schema_version;
    let data_length = encrypted_metadata.len() as u32;

    // Initialize audit metadata
    ctx.accounts.audit_metadata.initialize(
        ctx.accounts.pool_config.key(),
        commitment,
        encrypted_metadata,
        schema_version,
        timestamp,
        ctx.bumps.audit_metadata,
    )?;

    // Update compliance statistics
    ctx.accounts
        .compliance_config
        .record_attachment(timestamp)?;

    // Emit event
    emit!(AuditMetadataAttached {
        pool: ctx.accounts.pool_config.key(),
        commitment,
        schema_version,
        data_length,
        timestamp,
    });

    msg!(
        "Audit metadata attached: commitment={:?}, size={}",
        &commitment[..8],
        data_length
    );

    Ok(())
}
