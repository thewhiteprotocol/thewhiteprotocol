//! Configure Compliance Instruction
//!
//! Configures compliance settings for the pool including audit requirements.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::events::ComplianceConfigured;
use crate::state::{ComplianceConfig, PoolConfig};

/// Accounts for configuring compliance settings
#[derive(Accounts)]
pub struct ConfigureCompliance<'info> {
    /// Pool authority (must be signer)
    pub authority: Signer<'info>,

    /// Pool configuration account
    #[account(
        has_one = authority @ WhiteProtocolError::Unauthorized,
        has_one = compliance_config,
    )]
    pub pool_config: Account<'info, PoolConfig>,

    /// Compliance configuration account
    #[account(mut)]
    pub compliance_config: Account<'info, ComplianceConfig>,
}

/// Handler for configure_compliance instruction
pub fn handler(
    ctx: Context<ConfigureCompliance>,
    require_encrypted_note: bool,
    audit_pubkey: Option<Pubkey>,
    metadata_schema_version: u8,
) -> Result<()> {
    let compliance = &mut ctx.accounts.compliance_config;

    let clock = Clock::get()?;
    let timestamp = clock.unix_timestamp;

    // Configure compliance settings
    compliance.configure(
        require_encrypted_note,
        audit_pubkey,
        metadata_schema_version,
        timestamp,
    );

    // Emit event
    emit!(ComplianceConfigured {
        pool: ctx.accounts.pool_config.key(),
        require_encrypted_note,
        audit_enabled: compliance.audit_enabled,
        audit_pubkey: compliance.audit_pubkey,
        compliance_level: compliance.compliance_level,
        timestamp,
    });

    msg!(
        "Compliance configured: level={}, require_note={}, audit={}",
        compliance.compliance_level,
        require_encrypted_note,
        compliance.audit_enabled
    );

    Ok(())
}
