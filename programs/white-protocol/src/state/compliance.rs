//! Compliance Configuration State - The White Protocol v2
//!
//! # Lightweight Compliance Layer
//! Provides optional audit and compliance features:
//! - Encrypted metadata attachment
//! - View key support (future)
//! - Audit trail configuration
//!
//! # Design Philosophy
//! The compliance layer is opt-in and configurable.
//! It provides hooks for regulatory compliance without
//! compromising core privacy guarantees for those who
//! don't need compliance features.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;

/// Maximum length for encrypted metadata
pub const MAX_ENCRYPTED_METADATA_LEN: usize = 1024;

/// Compliance Configuration account
///
/// PDA Seeds: `[b"compliance", pool.key().as_ref()]`
#[account]
pub struct ComplianceConfig {
    /// Reference to parent pool
    pub pool: Pubkey,

    /// Whether encrypted note is required on deposits
    pub require_encrypted_note: bool,

    /// Audit public key (for view key decryption)
    /// If set, metadata can be encrypted to this key
    pub audit_pubkey: Pubkey,

    /// Whether audit is enabled
    pub audit_enabled: bool,

    /// Schema version for metadata format
    pub metadata_schema_version: u8,

    /// Total attachments made
    pub attachment_count: u64,

    /// Configuration timestamp
    pub configured_at: i64,

    /// Last update timestamp
    pub last_updated_at: i64,

    /// PDA bump seed
    pub bump: u8,

    /// Compliance level (0 = none, 1 = basic, 2 = full)
    pub compliance_level: u8,

    /// Reserved for future use
    pub _reserved: [u8; 64],
}

impl ComplianceConfig {
    pub const LEN: usize = 8  // discriminator
        + 32                  // pool
        + 1                   // require_encrypted_note
        + 32                  // audit_pubkey
        + 1                   // audit_enabled
        + 1                   // metadata_schema_version
        + 8                   // attachment_count
        + 8                   // configured_at
        + 8                   // last_updated_at
        + 1                   // bump
        + 1                   // compliance_level
        + 64; // reserved

    /// Compliance levels
    pub const COMPLIANCE_NONE: u8 = 0;
    pub const COMPLIANCE_BASIC: u8 = 1;
    pub const COMPLIANCE_FULL: u8 = 2;

    /// Initialize compliance config
    pub fn initialize(&mut self, pool: Pubkey, bump: u8, timestamp: i64) {
        self.pool = pool;
        self.require_encrypted_note = false;
        self.audit_pubkey = Pubkey::default();
        self.audit_enabled = false;
        self.metadata_schema_version = 1;
        self.attachment_count = 0;
        self.configured_at = timestamp;
        self.last_updated_at = timestamp;
        self.bump = bump;
        self.compliance_level = Self::COMPLIANCE_NONE;
        self._reserved = [0u8; 64];
    }

    /// Configure compliance settings
    pub fn configure(
        &mut self,
        require_encrypted_note: bool,
        audit_pubkey: Option<Pubkey>,
        metadata_schema_version: u8,
        timestamp: i64,
    ) {
        self.require_encrypted_note = require_encrypted_note;

        if let Some(pubkey) = audit_pubkey {
            self.audit_pubkey = pubkey;
            self.audit_enabled = pubkey != Pubkey::default();
        }

        self.metadata_schema_version = metadata_schema_version;
        self.last_updated_at = timestamp;

        // Update compliance level based on settings
        if self.audit_enabled && self.require_encrypted_note {
            self.compliance_level = Self::COMPLIANCE_FULL;
        } else if self.audit_enabled || self.require_encrypted_note {
            self.compliance_level = Self::COMPLIANCE_BASIC;
        } else {
            self.compliance_level = Self::COMPLIANCE_NONE;
        }
    }

    /// Record an attachment
    pub fn record_attachment(&mut self, timestamp: i64) -> Result<()> {
        self.attachment_count = self
            .attachment_count
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        self.last_updated_at = timestamp;
        Ok(())
    }

    /// Check if encrypted note is required
    pub fn check_note_requirement(&self, has_note: bool) -> Result<()> {
        if self.require_encrypted_note {
            require!(has_note, WhiteProtocolError::EncryptedNoteRequired);
        }
        Ok(())
    }

    /// Get audit pubkey if enabled
    pub fn get_audit_pubkey(&self) -> Option<Pubkey> {
        if self.audit_enabled && self.audit_pubkey != Pubkey::default() {
            Some(self.audit_pubkey)
        } else {
            None
        }
    }

    /// Enable audit with a public key
    pub fn enable_audit(&mut self, pubkey: Pubkey, timestamp: i64) -> Result<()> {
        require!(
            pubkey != Pubkey::default(),
            WhiteProtocolError::InvalidAuthority
        );
        self.audit_pubkey = pubkey;
        self.audit_enabled = true;
        self.last_updated_at = timestamp;
        Ok(())
    }

    /// Disable audit
    pub fn disable_audit(&mut self, timestamp: i64) {
        self.audit_enabled = false;
        self.last_updated_at = timestamp;
    }
}

/// PDA seeds for ComplianceConfig
impl ComplianceConfig {
    pub const SEED_PREFIX: &'static [u8] = b"compliance";

    pub fn find_pda(program_id: &Pubkey, pool: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[Self::SEED_PREFIX, pool.as_ref()], program_id)
    }
}

/// Audit Metadata attachment account
///
/// PDA Seeds: `[b"audit_metadata", pool.key().as_ref(), commitment.as_ref()]`
///
/// Stores encrypted metadata associated with a specific commitment.
/// The metadata is encrypted to the audit pubkey and can be decrypted
/// by authorized auditors.
#[account]
pub struct AuditMetadata {
    /// Reference to parent pool
    pub pool: Pubkey,

    /// Commitment this metadata is attached to
    pub commitment: [u8; 32],

    /// Encrypted metadata blob
    /// Format depends on metadata_schema_version in ComplianceConfig
    pub encrypted_data: Vec<u8>,

    /// Schema version used for this metadata
    pub schema_version: u8,

    /// Attachment timestamp
    pub attached_at: i64,

    /// PDA bump seed
    pub bump: u8,
}

impl AuditMetadata {
    pub const fn space(data_len: usize) -> usize {
        8                   // discriminator
            + 32            // pool
            + 32            // commitment
            + 4 + data_len  // encrypted_data (vec)
            + 1             // schema_version
            + 8             // attached_at
            + 1 // bump
    }

    pub const DEFAULT_SPACE: usize = Self::space(MAX_ENCRYPTED_METADATA_LEN);

    /// Initialize audit metadata
    pub fn initialize(
        &mut self,
        pool: Pubkey,
        commitment: [u8; 32],
        encrypted_data: Vec<u8>,
        schema_version: u8,
        timestamp: i64,
        bump: u8,
    ) -> Result<()> {
        require!(
            encrypted_data.len() <= MAX_ENCRYPTED_METADATA_LEN,
            WhiteProtocolError::InputTooLarge
        );

        self.pool = pool;
        self.commitment = commitment;
        self.encrypted_data = encrypted_data;
        self.schema_version = schema_version;
        self.attached_at = timestamp;
        self.bump = bump;
        Ok(())
    }
}

/// PDA seeds for AuditMetadata
impl AuditMetadata {
    pub const SEED_PREFIX: &'static [u8] = b"audit_metadata";

    pub fn find_pda(program_id: &Pubkey, pool: &Pubkey, commitment: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, pool.as_ref(), commitment.as_ref()],
            program_id,
        )
    }
}

/// Encrypted note format (for SDK reference)
/// This is serialized and encrypted client-side
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct EncryptedNoteSchema {
    /// Version of this schema
    pub version: u8,
    /// Recipient identifier (could be encrypted pubkey)
    pub recipient_hint: [u8; 32],
    /// Amount (encrypted)
    pub amount_ciphertext: [u8; 32],
    /// Asset ID (encrypted)
    pub asset_ciphertext: [u8; 32],
    /// Random blinding factor
    pub blinding: [u8; 32],
    /// Optional memo (encrypted)
    pub memo: Vec<u8>,
}

impl EncryptedNoteSchema {
    pub const VERSION: u8 = 1;

    pub fn serialized_len(&self) -> usize {
        1               // version
            + 32        // recipient_hint
            + 32        // amount_ciphertext
            + 32        // asset_ciphertext
            + 32        // blinding
            + 4 + self.memo.len() // memo (vec)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_compliance_levels() {
        let mut config = ComplianceConfig {
            pool: Pubkey::default(),
            require_encrypted_note: false,
            audit_pubkey: Pubkey::default(),
            audit_enabled: false,
            metadata_schema_version: 1,
            attachment_count: 0,
            configured_at: 0,
            last_updated_at: 0,
            bump: 0,
            compliance_level: 0,
            _reserved: [0u8; 64],
        };

        // No compliance
        config.configure(false, None, 1, 0);
        assert_eq!(config.compliance_level, ComplianceConfig::COMPLIANCE_NONE);

        // Basic compliance (encrypted note required)
        config.configure(true, None, 1, 0);
        assert_eq!(config.compliance_level, ComplianceConfig::COMPLIANCE_BASIC);

        // Full compliance (both enabled)
        config.configure(true, Some(Pubkey::new_unique()), 1, 0);
        assert_eq!(config.compliance_level, ComplianceConfig::COMPLIANCE_FULL);
    }

    #[test]
    fn test_space_calculation() {
        let space = ComplianceConfig::LEN;
        assert!(space < 300);

        let metadata_space = AuditMetadata::DEFAULT_SPACE;
        assert!(metadata_space < 2000);
    }
}
