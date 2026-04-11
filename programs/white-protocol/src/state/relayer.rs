//! Relayer Registry State - The White Protocol v2
//!
//! # On-Chain Relayer Management
//! v2 introduces structured relayer management with:
//! - Registry-level fee bounds
//! - Individual relayer accounts
//! - Optional staking requirements
//! - Activity tracking
//!
//! # Relayer Flow
//! 1. Admin configures RelayerRegistry with fee rules
//! 2. Relayer operators register via register_relayer
//! 3. Users can query active relayers and their fees
//! 4. Withdrawals/transfers validate relayer is registered and active

use crate::error::WhiteProtocolError;
use anchor_lang::prelude::*;

/// Maximum metadata URI length
pub const MAX_RELAYER_METADATA_URI_LEN: usize = 200;

/// Relayer Registry - global configuration for all relayers
///
/// PDA Seeds: `[b"relayer_registry", pool.key().as_ref()]`
#[account]
pub struct RelayerRegistry {
    /// Reference to parent pool
    pub pool: Pubkey,

    /// Minimum fee in basis points (1 bp = 0.01%)
    pub min_fee_bps: u16,

    /// Maximum fee in basis points
    pub max_fee_bps: u16,

    /// Whether relayers must stake to be active
    pub require_stake: bool,

    /// Minimum stake amount (if required)
    pub min_stake_amount: u64,

    /// Total registered relayers
    pub relayer_count: u32,

    /// Active relayer count
    pub active_relayer_count: u32,

    /// Total fees collected by all relayers
    pub total_fees_collected: u64,

    /// Total transactions processed by relayers
    pub total_transactions: u64,

    /// Registry creation timestamp
    pub created_at: i64,

    /// Last update timestamp
    pub last_updated_at: i64,

    /// PDA bump seed
    pub bump: u8,

    /// Whether new registrations are allowed
    pub registrations_open: bool,

    /// Reserved for future use
    pub _reserved: [u8; 32],
}

impl RelayerRegistry {
    pub const LEN: usize = 8  // discriminator
        + 32                  // pool
        + 2                   // min_fee_bps
        + 2                   // max_fee_bps
        + 1                   // require_stake
        + 8                   // min_stake_amount
        + 4                   // relayer_count
        + 4                   // active_relayer_count
        + 8                   // total_fees_collected
        + 8                   // total_transactions
        + 8                   // created_at
        + 8                   // last_updated_at
        + 1                   // bump
        + 1                   // registrations_open
        + 32; // reserved

    /// Default fee bounds
    pub const DEFAULT_MIN_FEE_BPS: u16 = 10; // 0.1%
    pub const DEFAULT_MAX_FEE_BPS: u16 = 500; // 5%

    /// Initialize the registry
    pub fn initialize(&mut self, pool: Pubkey, bump: u8, timestamp: i64) {
        self.pool = pool;
        self.min_fee_bps = Self::DEFAULT_MIN_FEE_BPS;
        self.max_fee_bps = Self::DEFAULT_MAX_FEE_BPS;
        self.require_stake = false;
        self.min_stake_amount = 0;
        self.relayer_count = 0;
        self.active_relayer_count = 0;
        self.total_fees_collected = 0;
        self.total_transactions = 0;
        self.created_at = timestamp;
        self.last_updated_at = timestamp;
        self.bump = bump;
        self.registrations_open = true;
        self._reserved = [0u8; 32];
    }

    /// Configure registry parameters
    pub fn configure(
        &mut self,
        min_fee_bps: u16,
        max_fee_bps: u16,
        require_stake: bool,
        min_stake_amount: u64,
        timestamp: i64,
    ) -> Result<()> {
        require!(
            min_fee_bps <= max_fee_bps,
            WhiteProtocolError::InvalidFeeConfiguration
        );
        require!(
            max_fee_bps <= 10000,
            WhiteProtocolError::InvalidFeeConfiguration
        ); // Max 100%

        self.min_fee_bps = min_fee_bps;
        self.max_fee_bps = max_fee_bps;
        self.require_stake = require_stake;
        self.min_stake_amount = min_stake_amount;
        self.last_updated_at = timestamp;
        Ok(())
    }

    /// Validate a relayer's fee is within bounds
    pub fn validate_fee(&self, fee_bps: u16) -> Result<()> {
        require!(
            fee_bps >= self.min_fee_bps && fee_bps <= self.max_fee_bps,
            WhiteProtocolError::RelayerFeeOutOfRange
        );
        Ok(())
    }

    /// Register a new relayer
    pub fn register_relayer(&mut self, timestamp: i64) -> Result<()> {
        require!(self.registrations_open, WhiteProtocolError::RegistrationsClosed);

        self.relayer_count = self
            .relayer_count
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.active_relayer_count = self
            .active_relayer_count
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.last_updated_at = timestamp;
        Ok(())
    }

    /// Record a relayer being deactivated
    pub fn deactivate_relayer(&mut self, timestamp: i64) -> Result<()> {
        self.active_relayer_count = self
            .active_relayer_count
            .checked_sub(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.last_updated_at = timestamp;
        Ok(())
    }

    /// Record a relayer being reactivated
    pub fn reactivate_relayer(&mut self, timestamp: i64) -> Result<()> {
        self.active_relayer_count = self
            .active_relayer_count
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.last_updated_at = timestamp;
        Ok(())
    }

    /// Record a completed transaction
    pub fn record_transaction(&mut self, fee_amount: u64, timestamp: i64) -> Result<()> {
        self.total_fees_collected = self
            .total_fees_collected
            .checked_add(fee_amount)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.total_transactions = self
            .total_transactions
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.last_updated_at = timestamp;
        Ok(())
    }

    /// Set registrations open/closed
    pub fn set_registrations_open(&mut self, open: bool, timestamp: i64) {
        self.registrations_open = open;
        self.last_updated_at = timestamp;
    }
}

/// PDA seeds for RelayerRegistry
impl RelayerRegistry {
    pub const SEED_PREFIX: &'static [u8] = b"relayer_registry";

    pub fn find_pda(program_id: &Pubkey, pool: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[Self::SEED_PREFIX, pool.as_ref()], program_id)
    }
}

/// Individual Relayer Node account
///
/// PDA Seeds: `[b"relayer", registry.key().as_ref(), operator.key().as_ref()]`
#[account]
pub struct RelayerNode {
    /// Reference to registry
    pub registry: Pubkey,

    /// Relayer operator (owner)
    pub operator: Pubkey,

    /// Fee in basis points
    pub fee_bps: u16,

    /// Whether this relayer is active
    pub is_active: bool,

    /// Stake amount (if staking required)
    pub stake_amount: u64,

    /// Total transactions processed
    pub transactions_processed: u64,

    /// Total fees earned
    pub fees_earned: u64,

    /// Registration timestamp
    pub registered_at: i64,

    /// Last activity timestamp
    pub last_active_at: i64,

    /// Metadata URI (endpoint info, etc.)
    pub metadata_uri: String,

    /// PDA bump seed
    pub bump: u8,

    /// Reputation score (0-100, for future use)
    pub reputation_score: u8,

    /// Reserved for future use
    pub _reserved: [u8; 16],
}

impl RelayerNode {
    pub const fn space(metadata_uri_len: usize) -> usize {
        8                           // discriminator
            + 32                    // registry
            + 32                    // operator
            + 2                     // fee_bps
            + 1                     // is_active
            + 8                     // stake_amount
            + 8                     // transactions_processed
            + 8                     // fees_earned
            + 8                     // registered_at
            + 8                     // last_active_at
            + 4 + metadata_uri_len  // metadata_uri
            + 1                     // bump
            + 1                     // reputation_score
            + 16 // reserved
    }

    pub const DEFAULT_SPACE: usize = Self::space(MAX_RELAYER_METADATA_URI_LEN);

    /// Initialize a new relayer node
    pub fn initialize(
        &mut self,
        registry: Pubkey,
        operator: Pubkey,
        fee_bps: u16,
        metadata_uri: String,
        bump: u8,
        timestamp: i64,
    ) {
        self.registry = registry;
        self.operator = operator;
        self.fee_bps = fee_bps;
        self.is_active = true;
        self.stake_amount = 0;
        self.transactions_processed = 0;
        self.fees_earned = 0;
        self.registered_at = timestamp;
        self.last_active_at = timestamp;
        self.metadata_uri = metadata_uri;
        self.bump = bump;
        self.reputation_score = 50; // Start at neutral
        self._reserved = [0u8; 16];
    }

    /// Update relayer configuration
    pub fn update(
        &mut self,
        fee_bps: Option<u16>,
        metadata_uri: Option<String>,
        is_active: Option<bool>,
        timestamp: i64,
    ) -> Result<()> {
        if let Some(fee) = fee_bps {
            self.fee_bps = fee;
        }
        if let Some(uri) = metadata_uri {
            require!(
                uri.len() <= MAX_RELAYER_METADATA_URI_LEN,
                WhiteProtocolError::InputTooLarge
            );
            self.metadata_uri = uri;
        }
        if let Some(active) = is_active {
            self.is_active = active;
        }
        self.last_active_at = timestamp;
        Ok(())
    }

    /// Record a completed transaction
    pub fn record_transaction(&mut self, fee_amount: u64, timestamp: i64) -> Result<()> {
        self.transactions_processed = self
            .transactions_processed
            .checked_add(1)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.fees_earned = self
            .fees_earned
            .checked_add(fee_amount)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;

        self.last_active_at = timestamp;
        Ok(())
    }

    /// Deactivate the relayer
    pub fn deactivate(&mut self, timestamp: i64) {
        self.is_active = false;
        self.last_active_at = timestamp;
    }

    /// Reactivate the relayer
    pub fn reactivate(&mut self, timestamp: i64) {
        self.is_active = true;
        self.last_active_at = timestamp;
    }

    /// Add stake
    pub fn add_stake(&mut self, amount: u64) -> Result<()> {
        self.stake_amount = self
            .stake_amount
            .checked_add(amount)
            .ok_or(error!(WhiteProtocolError::ArithmeticOverflow))?;
        Ok(())
    }

    /// Calculate fee for a given amount
    pub fn calculate_fee(&self, amount: u64) -> Result<u64> {
        amount
            .checked_mul(self.fee_bps as u64)
            .and_then(|v| v.checked_div(10_000))
            .ok_or_else(|| error!(WhiteProtocolError::ArithmeticOverflow))
    }
}

/// PDA seeds for RelayerNode
impl RelayerNode {
    pub const SEED_PREFIX: &'static [u8] = b"relayer";

    pub fn find_pda(program_id: &Pubkey, registry: &Pubkey, operator: &Pubkey) -> (Pubkey, u8) {
        Pubkey::find_program_address(
            &[Self::SEED_PREFIX, registry.as_ref(), operator.as_ref()],
            program_id,
        )
    }

    /// Validates that this RelayerNode belongs to `expected_registry` and that the passed
    /// account key matches the canonical PDA derivation.
    ///
    /// PDA seeds: [b"relayer", expected_registry, operator]
    pub fn validate_registry_and_pda(
        &self,
        program_id: &Pubkey,
        expected_registry: &Pubkey,
        account_key: &Pubkey,
    ) -> Result<()> {
        // 1) Ensure the node claims the expected registry
        require_keys_eq!(
            self.registry,
            *expected_registry,
            WhiteProtocolError::RelayerNodeRegistryMismatch
        );

        // 2) Ensure the account address is the canonical PDA for (registry, operator)
        let (expected_pda, _bump) = Self::find_pda(program_id, expected_registry, &self.operator);
        require_keys_eq!(
            *account_key,
            expected_pda,
            WhiteProtocolError::InvalidRelayerNodePda
        );

        Ok(())
    }
    pub fn seeds<'a>(
        registry: &'a Pubkey,
        operator: &'a Pubkey,
        bump: &'a [u8; 1],
    ) -> [&'a [u8]; 4] {
        [
            Self::SEED_PREFIX,
            registry.as_ref(),
            operator.as_ref(),
            bump,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fee_validation() {
        let registry = RelayerRegistry {
            pool: Pubkey::default(),
            min_fee_bps: 10,
            max_fee_bps: 500,
            require_stake: false,
            min_stake_amount: 0,
            relayer_count: 0,
            active_relayer_count: 0,
            total_fees_collected: 0,
            total_transactions: 0,
            created_at: 0,
            last_updated_at: 0,
            bump: 0,
            registrations_open: true,
            _reserved: [0u8; 32],
        };

        assert!(registry.validate_fee(100).is_ok());
        assert!(registry.validate_fee(10).is_ok());
        assert!(registry.validate_fee(500).is_ok());
        assert!(registry.validate_fee(5).is_err()); // Below min
        assert!(registry.validate_fee(1000).is_err()); // Above max
    }

    #[test]
    fn test_fee_calculation() {
        let relayer = RelayerNode {
            registry: Pubkey::default(),
            operator: Pubkey::default(),
            fee_bps: 100, // 1%
            is_active: true,
            stake_amount: 0,
            transactions_processed: 0,
            fees_earned: 0,
            registered_at: 0,
            last_active_at: 0,
            metadata_uri: String::new(),
            bump: 0,
            reputation_score: 50,
            _reserved: [0u8; 16],
        };

        let fee = relayer.calculate_fee(10_000).unwrap();
        assert_eq!(fee, 100); // 1% of 10000 = 100
    }

    fn assert_err_contains(err: anchor_lang::error::Error, needle: &str) {
        let s = err.to_string();
        assert!(
            s.contains(needle),
            "expected error to contain `{}`, got `{}`",
            needle,
            s
        );
    }

    #[test]
    fn test_validate_registry_and_pda_happy_path() {
        let program_id = Pubkey::new_unique();
        let registry = Pubkey::new_unique();
        let operator = Pubkey::new_unique();

        let (pda, bump) = RelayerNode::find_pda(&program_id, &registry, &operator);

        let node = RelayerNode {
            registry,
            operator,
            fee_bps: 100,
            is_active: true,
            stake_amount: 0,
            transactions_processed: 0,
            fees_earned: 0,
            registered_at: 0,
            last_active_at: 0,
            metadata_uri: String::new(),
            bump,
            reputation_score: 50,
            _reserved: [0u8; 16],
        };

        assert!(node
            .validate_registry_and_pda(&program_id, &registry, &pda)
            .is_ok());
    }

    #[test]
    fn test_validate_registry_and_pda_wrong_registry_fails() {
        let program_id = Pubkey::new_unique();
        let actual_registry = Pubkey::new_unique();
        let expected_registry = Pubkey::new_unique();
        let operator = Pubkey::new_unique();

        let (pda_expected, bump) =
            RelayerNode::find_pda(&program_id, &expected_registry, &operator);

        let node = RelayerNode {
            registry: actual_registry,
            operator,
            fee_bps: 100,
            is_active: true,
            stake_amount: 0,
            transactions_processed: 0,
            fees_earned: 0,
            registered_at: 0,
            last_active_at: 0,
            metadata_uri: String::new(),
            bump,
            reputation_score: 50,
            _reserved: [0u8; 16],
        };

        let err = node
            .validate_registry_and_pda(&program_id, &expected_registry, &pda_expected)
            .unwrap_err();

        // Message comes from #[msg(...)] on WhiteProtocolError::RelayerNodeRegistryMismatch
        assert_err_contains(err, "RelayerNode registry mismatch");
    }

    #[test]
    fn test_validate_registry_and_pda_wrong_pda_fails() {
        let program_id = Pubkey::new_unique();
        let registry = Pubkey::new_unique();
        let operator = Pubkey::new_unique();

        let (_pda, bump) = RelayerNode::find_pda(&program_id, &registry, &operator);

        let node = RelayerNode {
            registry,
            operator,
            fee_bps: 100,
            is_active: true,
            stake_amount: 0,
            transactions_processed: 0,
            fees_earned: 0,
            registered_at: 0,
            last_active_at: 0,
            metadata_uri: String::new(),
            bump,
            reputation_score: 50,
            _reserved: [0u8; 16],
        };

        let wrong_key = Pubkey::new_unique();

        let err = node
            .validate_registry_and_pda(&program_id, &registry, &wrong_key)
            .unwrap_err();

        // Message comes from #[msg(...)] on WhiteProtocolError::InvalidRelayerNodePda
        assert_err_contains(err, "Invalid RelayerNode PDA");
    }
}
