use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::ProofType;

#[account]
pub struct PoolConfig {
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
    pub merkle_tree: Pubkey,
    pub relayer_registry: Pubkey,
    pub compliance_config: Pubkey,

    /// Yield Mode: relayer that can sign yield withdrawals (5% fee enforcement)
    pub yield_relayer: Pubkey,

    pub tree_depth: u8,
    pub registered_asset_count: u16,
    pub max_assets: u16,
    pub bump: u8,
    pub is_paused: bool,
    pub vk_configured: u8,
    pub vk_locked: u8,

    /// Yield Mode: performance fee in basis points (500 = 5%)
    pub yield_fee_bps: u16,

    pub total_deposits: u64,
    pub total_withdrawals: u64,
    pub total_join_splits: u64,
    pub total_membership_proofs: u64,
    pub created_at: i64,
    pub last_activity_at: i64,
    pub version: u8,
    pub feature_flags: u8,
    pub _reserved: [u8; 30],
}

impl PoolConfig {
    pub const LEN: usize = 8
        + 32
        + 32
        + 32
        + 32
        + 32
        + 32
        + 1
        + 2
        + 2
        + 1
        + 1
        + 1
        + 1
        + 2
        + 8
        + 8
        + 8
        + 8
        + 8
        + 8
        + 1
        + 1
        + 30;
    pub const VERSION: u8 = 2;
    pub const DEFAULT_MAX_ASSETS: u16 = 100;
    pub const FEATURE_MASP: u8 = 1 << 0;
    pub const FEATURE_JOIN_SPLIT: u8 = 1 << 1;
    pub const FEATURE_MEMBERSHIP: u8 = 1 << 2;
    pub const FEATURE_SHIELDED_CPI: u8 = 1 << 3;
    pub const FEATURE_COMPLIANCE: u8 = 1 << 4;
    pub const FEATURE_YIELD_ENFORCEMENT: u8 = 1 << 5;
    pub const YIELD_FEE_BPS: u16 = 500; // 5% performance fee

    #[allow(clippy::too_many_arguments)]
    pub fn initialize(
        &mut self,
        authority: Pubkey,
        merkle_tree: Pubkey,
        relayer_registry: Pubkey,
        compliance_config: Pubkey,
        tree_depth: u8,
        bump: u8,
        timestamp: i64,
        yield_relayer: Pubkey,
    ) {
        self.authority = authority;
        self.pending_authority = Pubkey::default();
        self.merkle_tree = merkle_tree;
        self.relayer_registry = relayer_registry;
        self.compliance_config = compliance_config;
        self.yield_relayer = yield_relayer;
        self.yield_fee_bps = Self::YIELD_FEE_BPS;
        self.tree_depth = tree_depth;
        self.registered_asset_count = 0;
        self.max_assets = Self::DEFAULT_MAX_ASSETS;
        self.bump = bump;
        self.is_paused = false;
        self.vk_configured = 0;
        self.vk_locked = 0;
        self.total_deposits = 0;
        self.total_withdrawals = 0;
        self.total_join_splits = 0;
        self.total_membership_proofs = 0;
        self.created_at = timestamp;
        self.last_activity_at = timestamp;
        self.max_assets = Self::DEFAULT_MAX_ASSETS;
        self.registered_asset_count = 0;
        self.version = Self::VERSION;
        self.feature_flags = Self::FEATURE_MASP;
        self._reserved = [0u8; 30];
    }

    #[inline]
    pub fn require_not_paused(&self) -> Result<()> {
        require!(!self.is_paused, WhiteProtocolError::PoolPaused);
        Ok(())
    }

    #[inline]
    pub fn require_vk_configured(&self, proof_type: ProofType) -> Result<()> {
        let mask = 1u8 << (proof_type as u8);
        require!(
            self.vk_configured & mask != 0,
            WhiteProtocolError::VerificationKeyNotSet
        );
        Ok(())
    }

    #[inline]
    pub fn require_vk_unlocked(&self, proof_type: ProofType) -> Result<()> {
        let mask = 1u8 << (proof_type as u8);
        require!(
            self.vk_locked & mask == 0,
            WhiteProtocolError::VerificationKeyLocked
        );
        Ok(())
    }

    #[inline]
    pub fn require_feature_enabled(&self, feature: u8) -> Result<()> {
        require!(
            self.feature_flags & feature != 0,
            WhiteProtocolError::FeatureDisabled
        );
        Ok(())
    }

    #[inline]
    pub fn require_join_split_enabled(&self) -> Result<()> {
        self.require_feature_enabled(Self::FEATURE_JOIN_SPLIT)
    }

    #[inline]
    pub fn require_membership_enabled(&self) -> Result<()> {
        self.require_feature_enabled(Self::FEATURE_MEMBERSHIP)
    }

    #[inline]
    pub fn require_shielded_cpi_enabled(&self) -> Result<()> {
        self.require_feature_enabled(Self::FEATURE_SHIELDED_CPI)
    }

    pub fn set_vk_configured(&mut self, proof_type: ProofType) {
        let mask = 1u8 << (proof_type as u8);
        self.vk_configured |= mask;
    }

    pub fn lock_vk(&mut self, proof_type: ProofType) {
        let mask = 1u8 << (proof_type as u8);
        self.vk_locked |= mask;
    }

    pub fn is_vk_configured(&self, proof_type: ProofType) -> bool {
        let mask = 1u8 << (proof_type as u8);
        self.vk_configured & mask != 0
    }

    pub fn is_vk_locked(&self, proof_type: ProofType) -> bool {
        let mask = 1u8 << (proof_type as u8);
        self.vk_locked & mask != 0
    }

    pub fn can_register_asset(&self) -> bool {
        self.registered_asset_count < self.max_assets
    }

    pub fn register_asset(&mut self) -> Result<()> {
        require!(self.can_register_asset(), WhiteProtocolError::TooManyAssets);
        self.registered_asset_count = self
            .registered_asset_count
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        Ok(())
    }

    pub fn record_deposit(&mut self, timestamp: i64) -> Result<()> {
        self.total_deposits = self
            .total_deposits
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        self.last_activity_at = timestamp;
        Ok(())
    }

    pub fn record_withdrawal(&mut self, timestamp: i64) -> Result<()> {
        self.total_withdrawals = self
            .total_withdrawals
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        self.last_activity_at = timestamp;
        Ok(())
    }

    pub fn record_join_split(&mut self, timestamp: i64) -> Result<()> {
        self.total_join_splits = self
            .total_join_splits
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        self.last_activity_at = timestamp;
        Ok(())
    }

    pub fn record_membership_proof(&mut self, timestamp: i64) -> Result<()> {
        self.total_membership_proofs = self
            .total_membership_proofs
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        self.last_activity_at = timestamp;
        Ok(())
    }

    pub fn record_pending_deposit(&mut self, timestamp: i64) -> Result<()> {
        self.last_activity_at = timestamp;
        Ok(())
    }

    pub fn record_batch(&mut self, count: u32, timestamp: i64) -> Result<()> {
        self.total_deposits = self
            .total_deposits
            .checked_add(count as u64)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        self.last_activity_at = timestamp;
        Ok(())
    }

    /// Check if yield enforcement is enabled
    pub fn is_yield_enforcement_enabled(&self) -> bool {
        (self.feature_flags & Self::FEATURE_YIELD_ENFORCEMENT) != 0
    }

    #[inline]
    pub fn set_paused(&mut self, paused: bool) {
        self.is_paused = paused;
    }

    pub fn initiate_authority_transfer(&mut self, new_authority: Pubkey) -> Result<()> {
        require!(
            new_authority != Pubkey::default(),
            WhiteProtocolError::InvalidAuthority
        );
        require!(
            new_authority != self.authority,
            WhiteProtocolError::InvalidAuthority
        );
        self.pending_authority = new_authority;
        Ok(())
    }

    pub fn accept_authority_transfer(&mut self, acceptor: Pubkey) -> Result<()> {
        require!(
            self.pending_authority != Pubkey::default(),
            WhiteProtocolError::NoPendingAuthority
        );
        require!(
            acceptor == self.pending_authority,
            WhiteProtocolError::Unauthorized
        );
        self.authority = self.pending_authority;
        self.pending_authority = Pubkey::default();
        Ok(())
    }

    pub fn cancel_authority_transfer(&mut self) {
        self.pending_authority = Pubkey::default();
    }

    #[inline]
    pub fn has_pending_transfer(&self) -> bool {
        self.pending_authority != Pubkey::default()
    }

    pub fn enable_feature(&mut self, feature: u8) {
        self.feature_flags |= feature;
    }

    pub fn disable_feature(&mut self, feature: u8) {
        self.feature_flags &= !feature;
    }

    pub fn is_feature_enabled(&self, feature: u8) -> bool {
        self.feature_flags & feature != 0
    }

    pub fn initialize_partial(
        &mut self,
        authority: Pubkey,
        merkle_tree: Pubkey,
        tree_depth: u8,
        bump: u8,
        timestamp: i64,
    ) {
        self.authority = authority;
        self.pending_authority = Pubkey::default();
        self.merkle_tree = merkle_tree;
        self.relayer_registry = Pubkey::default();
        self.compliance_config = Pubkey::default();
        self.yield_relayer = Pubkey::default();
        self.yield_fee_bps = Self::YIELD_FEE_BPS;
        self.tree_depth = tree_depth;
        self.total_deposits = 0;
        self.total_withdrawals = 0;
        self.is_paused = false;
        self.bump = bump;
        self.created_at = timestamp;
        self.last_activity_at = timestamp;
        self.max_assets = Self::DEFAULT_MAX_ASSETS;
        self.registered_asset_count = 0;
        self.feature_flags = Self::FEATURE_MASP;
        self._reserved = [0u8; 30];
    }

    pub fn set_registries(
        &mut self,
        relayer_registry: Pubkey,
        compliance_config: Pubkey,
        yield_relayer: Pubkey,
    ) {
        self.relayer_registry = relayer_registry;
        self.compliance_config = compliance_config;
        self.yield_relayer = yield_relayer;
        self.yield_fee_bps = Self::YIELD_FEE_BPS;
    }
}

impl PoolConfig {
    pub const SEED_PREFIX: &'static [u8] = b"white_pool";

    pub fn find_pda(program_id: &Pubkey, authority: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[Self::SEED_PREFIX, authority.as_ref()], program_id)
    }

    pub fn seeds<'a>(authority: &'a Pubkey, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
        [Self::SEED_PREFIX, authority.as_ref(), bump]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vk_flags() {
        let mut config = PoolConfig {
            authority: Pubkey::default(),
            pending_authority: Pubkey::default(),
            merkle_tree: Pubkey::default(),
            relayer_registry: Pubkey::default(),
            compliance_config: Pubkey::default(),
            yield_relayer: Pubkey::default(),
            yield_fee_bps: 500,
            tree_depth: 20,
            registered_asset_count: 0,
            max_assets: 100,
            bump: 0,
            is_paused: false,
            vk_configured: 0,
            vk_locked: 0,
            total_deposits: 0,
            total_withdrawals: 0,
            total_join_splits: 0,
            total_membership_proofs: 0,
            created_at: 0,
            last_activity_at: 0,
            version: 2,
            feature_flags: 0,
            _reserved: [0u8; 30],
        };

        assert!(!config.is_vk_configured(ProofType::Withdraw));
        config.set_vk_configured(ProofType::Withdraw);
        assert!(config.is_vk_configured(ProofType::Withdraw));
        assert!(!config.is_vk_configured(ProofType::JoinSplit));

        assert!(!config.is_vk_locked(ProofType::Withdraw));
        config.lock_vk(ProofType::Withdraw);
        assert!(config.is_vk_locked(ProofType::Withdraw));
    }

    #[test]
    fn test_feature_flags() {
        let mut config = PoolConfig {
            authority: Pubkey::default(),
            pending_authority: Pubkey::default(),
            merkle_tree: Pubkey::default(),
            relayer_registry: Pubkey::default(),
            compliance_config: Pubkey::default(),
            yield_relayer: Pubkey::default(),
            yield_fee_bps: 500,
            tree_depth: 20,
            registered_asset_count: 0,
            max_assets: 100,
            bump: 0,
            is_paused: false,
            vk_configured: 0,
            vk_locked: 0,
            total_deposits: 0,
            total_withdrawals: 0,
            total_join_splits: 0,
            total_membership_proofs: 0,
            created_at: 0,
            last_activity_at: 0,
            version: 2,
            feature_flags: PoolConfig::FEATURE_MASP,
            _reserved: [0u8; 30],
        };

        assert!(config.is_feature_enabled(PoolConfig::FEATURE_MASP));
        assert!(!config.is_feature_enabled(PoolConfig::FEATURE_JOIN_SPLIT));

        config.enable_feature(PoolConfig::FEATURE_JOIN_SPLIT);
        assert!(config.is_feature_enabled(PoolConfig::FEATURE_JOIN_SPLIT));

        config.disable_feature(PoolConfig::FEATURE_JOIN_SPLIT);
        assert!(!config.is_feature_enabled(PoolConfig::FEATURE_JOIN_SPLIT));
    }
}
