//! Asset Vault State - The White Protocol v2 MASP
//!
//! # Multi-Asset Support
//! Each registered asset has its own vault account storing:
//! - SPL token account for that asset
//! - Deposit/withdrawal statistics
//! - Asset-specific configuration
//!
//! # Asset ID
//! asset_id = Keccak256(mint_address)[0..32]
//! This provides a consistent 32-byte identifier for use in commitments.

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;

/// Maximum length for asset metadata URI
pub const MAX_METADATA_URI_LEN: usize = 200;

/// Asset vault account - one per registered asset
///
/// PDA Seeds: `[b"vault", pool.key().as_ref(), asset_id.as_ref()]`
#[account]
pub struct AssetVault {
    /// Reference to parent pool
    pub pool: Pubkey,

    /// Asset identifier (derived from mint)
    pub asset_id: [u8; 32],

    /// SPL token mint address
    pub mint: Pubkey,

    /// Token account holding shielded assets
    pub token_account: Pubkey,

    /// PDA bump seed
    pub bump: u8,

    /// Whether this asset is active
    pub is_active: bool,

    /// Whether deposits are enabled
    pub deposits_enabled: bool,

    /// Whether withdrawals are enabled
    pub withdrawals_enabled: bool,

    /// Minimum deposit amount (in token base units)
    pub min_deposit: u64,

    /// Maximum deposit amount per transaction
    pub max_deposit: u64,

    /// Total value deposited (lifetime)
    pub total_deposited: u64,

    /// Total value withdrawn (lifetime)
    pub total_withdrawn: u64,

    /// Current shielded balance (should match token account)
    pub shielded_balance: u64,

    /// Number of deposits
    pub deposit_count: u64,

    /// Number of withdrawals
    pub withdrawal_count: u64,

    /// Asset registration timestamp
    pub registered_at: i64,

    /// Last activity timestamp
    pub last_activity_at: i64,

    /// Token decimals (cached from mint)
    pub decimals: u8,

    /// Asset type (0 = SPL Token, 1 = Native SOL wrapped, 2 = Token-2022)
    pub asset_type: u8,

    /// Optional metadata URI for asset info
    pub metadata_uri: String,

    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl AssetVault {
    pub const fn space(metadata_uri_len: usize) -> usize {
        8                           // discriminator
            + 32                    // pool
            + 32                    // asset_id
            + 32                    // mint
            + 32                    // token_account
            + 1                     // bump
            + 1                     // is_active
            + 1                     // deposits_enabled
            + 1                     // withdrawals_enabled
            + 8                     // min_deposit
            + 8                     // max_deposit
            + 8                     // total_deposited
            + 8                     // total_withdrawn
            + 8                     // shielded_balance
            + 8                     // deposit_count
            + 8                     // withdrawal_count
            + 8                     // registered_at
            + 8                     // last_activity_at
            + 1                     // decimals
            + 1                     // asset_type
            + 4 + metadata_uri_len  // metadata_uri (String)
            + 32 // reserved
    }

    pub const DEFAULT_SPACE: usize = Self::space(MAX_METADATA_URI_LEN);

    /// Asset type constants
    pub const ASSET_TYPE_SPL: u8 = 0;
    pub const ASSET_TYPE_NATIVE_SOL: u8 = 1;
    pub const ASSET_TYPE_TOKEN_2022: u8 = 2;

    /// Initialize a new asset vault
    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        pool: Pubkey,
        asset_id: [u8; 32],
        mint: Pubkey,
        token_account: Pubkey,
        bump: u8,
        decimals: u8,
        asset_type: u8,
        timestamp: i64,
    ) {
        self.pool = pool;
        self.asset_id = asset_id;
        self.mint = mint;
        self.token_account = token_account;
        self.bump = bump;
        self.is_active = true;
        self.deposits_enabled = true;
        self.withdrawals_enabled = true;
        self.min_deposit = 0;
        self.max_deposit = u64::MAX;
        self.total_deposited = 0;
        self.total_withdrawn = 0;
        self.shielded_balance = 0;
        self.deposit_count = 0;
        self.withdrawal_count = 0;
        self.registered_at = timestamp;
        self.last_activity_at = timestamp;
        self.decimals = decimals;
        self.asset_type = asset_type;
        self.metadata_uri = String::new();
        self._reserved = [0u8; 32];
    }

    // =========================================================================
    // Guard Methods
    // =========================================================================

    #[inline]
    pub fn require_active(&self) -> Result<()> {
        require!(self.is_active, WhiteProtocolError::AssetNotActive);
        Ok(())
    }

    #[inline]
    pub fn require_deposits_enabled(&self) -> Result<()> {
        require!(self.deposits_enabled, WhiteProtocolError::DepositsDisabled);
        Ok(())
    }

    #[inline]
    pub fn require_withdrawals_enabled(&self) -> Result<()> {
        require!(
            self.withdrawals_enabled,
            WhiteProtocolError::WithdrawalsDisabled
        );
        Ok(())
    }

    pub fn validate_deposit_amount(&self, amount: u64) -> Result<()> {
        require!(
            amount >= self.min_deposit,
            WhiteProtocolError::BelowMinimumDeposit
        );
        require!(
            amount <= self.max_deposit,
            WhiteProtocolError::ExceedsMaximumDeposit
        );
        Ok(())
    }

    pub fn validate_withdrawal_amount(&self, amount: u64) -> Result<()> {
        require!(
            amount <= self.shielded_balance,
            WhiteProtocolError::InsufficientBalance
        );
        Ok(())
    }

    // =========================================================================
    // Balance Management
    // =========================================================================

    pub fn record_deposit(&mut self, amount: u64, timestamp: i64) -> Result<()> {
        self.total_deposited = self
            .total_deposited
            .checked_add(amount)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.shielded_balance = self
            .shielded_balance
            .checked_add(amount)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.deposit_count = self
            .deposit_count
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.last_activity_at = timestamp;
        Ok(())
    }

    pub fn record_withdrawal(&mut self, amount: u64, timestamp: i64) -> Result<()> {
        self.total_withdrawn = self
            .total_withdrawn
            .checked_add(amount)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.shielded_balance = self
            .shielded_balance
            .checked_sub(amount)
            .ok_or(error!(WhiteProtocolError::InsufficientBalance))?;

        self.withdrawal_count = self
            .withdrawal_count
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.last_activity_at = timestamp;
        Ok(())
    }

    // =========================================================================
    // Configuration
    // =========================================================================

    pub fn set_active(&mut self, active: bool) {
        self.is_active = active;
    }

    pub fn set_deposits_enabled(&mut self, enabled: bool) {
        self.deposits_enabled = enabled;
    }

    pub fn set_withdrawals_enabled(&mut self, enabled: bool) {
        self.withdrawals_enabled = enabled;
    }

    pub fn set_deposit_limits(&mut self, min: u64, max: u64) -> Result<()> {
        require!(min <= max, WhiteProtocolError::InvalidAmount);
        self.min_deposit = min;
        self.max_deposit = max;
        Ok(())
    }

    pub fn set_metadata_uri(&mut self, uri: String) -> Result<()> {
        require!(
            uri.len() <= MAX_METADATA_URI_LEN,
            WhiteProtocolError::InputTooLarge
        );
        self.metadata_uri = uri;
        Ok(())
    }
}

/// PDA seeds for AssetVault
impl AssetVault {
    pub const SEED_PREFIX: &'static [u8] = b"vault";

    pub fn find_pda(program_id: &Pubkey, pool: &Pubkey, asset_id: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, pool.as_ref(), asset_id.as_ref()],
            program_id,
        )
    }

    pub fn seeds<'a>(pool: &'a Pubkey, asset_id: &'a [u8; 32], bump: &'a [u8; 1]) -> [&'a [u8]; 4] {
        [Self::SEED_PREFIX, pool.as_ref(), asset_id.as_ref(), bump]
    }
}

/// Helper to compute v1 asset_id from mint address (legacy, for existing pools).
pub fn compute_asset_id(mint: &Pubkey) -> [u8; 32] {
    compute_asset_id_v1(mint)
}

/// Helper to compute v1 asset_id from mint address.
pub fn compute_asset_id_v1(mint: &Pubkey) -> [u8; 32] {
    // Canonical, deterministic asset_id suitable for BN254 Fr public inputs.
    //
    // Raw Keccak256(mint) is a random 256-bit value and will often be >= Fr modulus,
    // which causes Groth16 verification to fail (public input not canonical).
    //
    // Off-chain circuits/SDK MUST use the same derivation:
    //   asset_id = 0x00 || Keccak256("white:asset_id:v1" || mint)[0..31]
    let h = crate::crypto::keccak::keccak256_concat(&[b"white:asset_id:v1", mint.as_ref()]);
    let mut out = [0u8; 32];
    out[1..32].copy_from_slice(&h[0..31]);
    out
}

/// Helper to compute v2 asset_id from mint address with domain separation.
///
/// Formula:
///   asset_id = 0x00 || Keccak256("white:asset_id:v2" || uint32BE(domain_id) || mint)[0..31]
pub fn compute_asset_id_v2(mint: &Pubkey, domain_id: u32) -> [u8; 32] {
    let domain_bytes = domain_id.to_be_bytes();
    let h = crate::crypto::keccak::keccak256_concat(&[
        b"white:asset_id:v2",
        &domain_bytes,
        mint.as_ref(),
    ]);
    let mut out = [0u8; 32];
    out[1..32].copy_from_slice(&h[0..31]);
    out
}

/// Native SOL asset ID (special case)
pub const NATIVE_SOL_ASSET_ID: [u8; 32] = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_asset_id_computation() {
        let mint = Pubkey::new_unique();
        let id1 = compute_asset_id(&mint);
        let id2 = compute_asset_id(&mint);
        assert_eq!(id1, id2);

        let mint2 = Pubkey::new_unique();
        let id3 = compute_asset_id(&mint2);
        assert_ne!(id1, id3);
    }

    #[test]
    fn test_space_calculation() {
        let space = AssetVault::DEFAULT_SPACE;
        assert!(space < 1000);
    }
}
