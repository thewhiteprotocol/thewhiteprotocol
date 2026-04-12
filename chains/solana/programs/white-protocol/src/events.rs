use anchor_lang::prelude::*;

// ============================================================================
// COMPILE-TIME SAFETY CHECK
// ============================================================================

// Prevent accidental mainnet builds with debug events enabled
#[cfg(all(feature = "event-debug", feature = "mainnet"))]
compile_error!(
    "SECURITY ERROR: event-debug feature must not be enabled for mainnet builds! \
     Debug events leak privacy-sensitive data (recipient, amount, depositor). \
     Remove event-debug feature or mainnet feature to proceed."
);

// =========================================================================
// POOL EVENTS
// =========================================================================

#[event]
pub struct PoolInitializedV2 {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub merkle_tree: Pubkey,
    pub relayer_registry: Pubkey,
    pub tree_depth: u8,
    pub root_history_size: u16,
    pub timestamp: i64,
}

#[event]
pub struct PoolPausedV2 {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct PoolUnpausedV2 {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityTransferInitiatedV2 {
    pub pool: Pubkey,
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityTransferCompletedV2 {
    pub pool: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct AuthorityTransferCancelledV2 {
    pub pool: Pubkey,
    pub authority: Pubkey,
    pub cancelled_pending: Pubkey,
    pub timestamp: i64,
}

// =========================================================================
// ASSET EVENTS
// =========================================================================

#[event]
pub struct AssetRegistered {
    pub pool: Pubkey,
    pub asset_id: [u8; 32],
    pub mint: Pubkey,
    pub vault: Pubkey,
    pub decimals: u8,
    pub timestamp: i64,
}

#[event]
pub struct AssetConfigUpdated {
    pub pool: Pubkey,
    pub asset_id: [u8; 32],
    pub deposits_enabled: bool,
    pub withdrawals_enabled: bool,
    pub timestamp: i64,
}

// =========================================================================
// VK EVENTS
// =========================================================================

#[event]
pub struct VerificationKeySetV2 {
    pub pool: Pubkey,
    pub proof_type: u8,
    pub ic_length: u8,
    pub vk_hash: [u8; 32],
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VerificationKeyLockedV2 {
    pub pool: Pubkey,
    pub proof_type: u8,
    pub authority: Pubkey,
    pub timestamp: i64,
}

// =========================================================================
// DEPOSIT/WITHDRAW EVENTS (PRIVACY-PRESERVING)
// =========================================================================

/// Privacy-preserving deposit event.
///
/// # Privacy Design
///
/// This event intentionally does NOT include:
/// - `amount` - Would enable correlation attacks (matching deposit/withdrawal amounts)
/// - `depositor` - Would link on-chain identity to shielded commitment
///
/// # Included Fields
///
/// - `commitment` - Needed for users to track their deposits
/// - `leaf_index` - Required to construct withdrawal proofs
/// - `merkle_root` - Lets clients verify tree state
/// - `asset_id` - Asset type (does not reveal amount or depositor)
///
/// While the depositor address is visible in transaction accounts, omitting it
/// from events makes large-scale indexing and correlation significantly harder.
#[event]
pub struct DepositMaspEvent {
    /// Pool this deposit belongs to
    pub pool: Pubkey,
    /// Commitment inserted into Merkle tree
    pub commitment: [u8; 32],
    /// Leaf index assigned in the shared Merkle tree (needed for withdrawal proofs)
    pub leaf_index: u32,
    /// New Merkle root after insertion
    pub merkle_root: [u8; 32],
    /// Asset identifier (Keccak(mint)[0..32])
    pub asset_id: [u8; 32],
    /// Event timestamp
    pub timestamp: i64,
}

/// Debug-only deposit event with additional information.
///
/// # Security Warning
///
/// This event is gated behind the `event-debug` feature flag and MUST NOT
/// be enabled in production builds. It leaks privacy-sensitive data that
/// would trivially de-anonymize deposits.
///
/// # Leaked Data
///
/// - `amount` - Enables amount correlation attacks
/// - `depositor` - Directly reveals depositor identity
#[cfg(feature = "event-debug")]
#[event]
pub struct DepositMaspDebugEvent {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub leaf_index: u32,
    /// WARNING: Leaks deposit amount for correlation attacks
    pub amount: u64,
    pub asset_id: [u8; 32],
    /// WARNING: Reveals depositor identity
    pub depositor: Pubkey,
    pub has_encrypted_note: bool,
    pub timestamp: i64,
}

/// Privacy-preserving withdrawal event.
///
/// # Privacy Design
///
/// This event intentionally does NOT include:
/// - `recipient` - Would link withdrawal to recipient identity
/// - `amount` - Would enable amount correlation attacks
///
/// # Included Fields
///
/// - `nullifier_hash` - Already public via SpentNullifier PDA
/// - `asset_id` - Asset type (common knowledge)
/// - `relayer` / `relayer_fee` - Needed for relayer accounting
///
/// While recipient is visible in transaction accounts (required for token delivery),
/// omitting it from events makes large-scale indexing and correlation significantly
/// harder - events are the primary data source for most indexing infrastructure.
#[event]
pub struct WithdrawMaspEvent {
    /// Pool this withdrawal belongs to
    pub pool: Pubkey,
    /// Spent nullifier (already public via SpentNullifier account)
    pub nullifier_hash: [u8; 32],
    /// Asset identifier (Keccak(mint)[0..32])
    pub asset_id: [u8; 32],
    /// Relayer that submitted the transaction
    pub relayer: Pubkey,
    /// Fee paid to relayer (needed for relayer accounting)
    pub relayer_fee: u64,
    /// Event timestamp
    pub timestamp: i64,
}

/// Withdrawal V2 event (join-split with change)
///
/// Privacy considerations:
/// - Does NOT include recipient or amounts (prevents correlation)
/// - Includes change_commitment for sequencer indexing
/// - Nullifier hashes are public (spent nullifier tracking)
#[event]
pub struct WithdrawV2Event {
    /// Pool this withdrawal belongs to
    pub pool: Pubkey,
    /// Asset identifier
    pub asset_id: [u8; 32],
    /// Primary spent nullifier
    pub nullifier_hash_0: [u8; 32],
    /// Secondary spent nullifier (0 if unused)
    pub nullifier_hash_1: [u8; 32],
    /// Change commitment (for sequencer indexing)
    pub change_commitment: [u8; 32],
    /// Merkle root used for proof
    pub merkle_root: [u8; 32],
    /// Event timestamp
    pub timestamp: i64,
    /// Slot number
    pub slot: u64,
}

/// Debug-only withdrawal event with full telemetry.
///
/// # Security Warning
///
/// This event is gated behind the `event-debug` feature flag and MUST NOT
/// be enabled in mainnet builds. It leaks recipient and amount at the event
/// layer, making correlation trivial.
#[cfg(feature = "event-debug")]
#[event]
pub struct WithdrawMaspDebugEvent {
    pub pool: Pubkey,
    pub nullifier_hash: [u8; 32],
    /// WARNING: Leaks recipient identity
    pub recipient: Pubkey,
    /// WARNING: Leaks withdrawal amount
    pub amount: u64,
    pub asset_id: [u8; 32],
    pub relayer: Pubkey,
    pub relayer_fee: u64,
    pub timestamp: i64,
}

// =========================================================================
// JOIN-SPLIT EVENTS
// =========================================================================

/// JoinSplit event for private transfers.
///
/// # Privacy Design
///
/// JoinSplit combines multiple inputs into multiple outputs, breaking
/// the link between individual deposits and withdrawals.
///
/// This event reveals:
/// - Number of inputs/outputs (structural, unavoidable)
/// - Nullifiers (already public via SpentNullifier)
/// - Output commitments (needed for recipients)
/// - Public amount delta (if any external transfer)
///
/// It does NOT reveal:
/// - Individual input amounts
/// - Individual output amounts
/// - Connection between specific inputs and outputs
#[event]
pub struct JoinSplitEvent {
    pub pool: Pubkey,
    /// Number of input nullifiers spent
    pub input_count: u8,
    /// Number of output commitments created
    pub output_count: u8,
    /// First nullifier hash (always present)
    pub nullifier_hash_0: [u8; 32],
    /// Second nullifier hash (zero if only 1 input)
    pub nullifier_hash_1: [u8; 32],
    /// First output commitment
    pub output_commitment_0: [u8; 32],
    /// Second output commitment (zero if only 1 output)
    pub output_commitment_1: [u8; 32],
    /// Public amount delta (positive = deposit, negative = withdraw, 0 = internal)
    pub public_amount: i64,
    /// Asset involved
    pub asset_id: [u8; 32],
    /// Relayer that submitted
    pub relayer: Pubkey,
    /// Fee paid
    pub relayer_fee: u64,
    /// Leaf indices for outputs (needed for subsequent proofs)
    pub output_leaf_indices: [u32; 2],
    pub timestamp: i64,
}

// =========================================================================
// MEMBERSHIP EVENTS
// =========================================================================

/// Membership proof verification event.
///
/// Used for proving balance >= threshold without revealing actual balance.
#[event]
pub struct MembershipProofVerified {
    pub pool: Pubkey,
    /// Threshold that was proven (user proved they have >= this amount)
    pub threshold: u64,
    /// Asset for the proof
    pub asset_id: [u8; 32],
    /// Merkle root used
    pub merkle_root: [u8; 32],
    /// Whether proof was valid
    pub is_valid: bool,
    pub timestamp: i64,
}

// =========================================================================
// RELAYER EVENTS
// =========================================================================

#[event]
pub struct RelayerRegistryConfigured {
    pub pool: Pubkey,
    pub registry: Pubkey,
    pub min_fee_bps: u16,
    pub max_fee_bps: u16,
    pub require_stake: bool,
    pub min_stake_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct RelayerRegistered {
    pub pool: Pubkey,
    pub registry: Pubkey,
    pub relayer: Pubkey,
    pub operator: Pubkey,
    pub fee_bps: u16,
    pub timestamp: i64,
}

#[event]
pub struct RelayerUpdated {
    pub pool: Pubkey,
    pub relayer: Pubkey,
    pub operator: Pubkey,
    pub fee_bps: u16,
    pub is_active: bool,
    pub timestamp: i64,
}

#[event]
pub struct RelayerDeactivated {
    pub pool: Pubkey,
    pub relayer: Pubkey,
    pub operator: Pubkey,
    pub timestamp: i64,
}

// =========================================================================
// COMPLIANCE EVENTS
// =========================================================================

#[event]
pub struct ComplianceConfigured {
    pub pool: Pubkey,
    pub require_encrypted_note: bool,
    pub audit_enabled: bool,
    pub audit_pubkey: Pubkey,
    pub compliance_level: u8,
    pub timestamp: i64,
}

#[event]
pub struct AuditMetadataAttached {
    pub pool: Pubkey,
    pub commitment: [u8; 32],
    pub schema_version: u8,
    pub data_length: u32,
    pub timestamp: i64,
}

// =========================================================================
// SHIELDED CPI EVENTS
// =========================================================================

#[event]
pub struct ShieldedActionExecuted {
    pub pool: Pubkey,
    pub action_type: u8,
    pub nullifier_hash: [u8; 32],
    pub output_commitment: [u8; 32],
    pub target_program: Pubkey,
    pub relayer: Pubkey,
    pub timestamp: i64,
}

// =========================================================================
// DEBUG EVENTS - GATED BEHIND event-debug FEATURE
// =========================================================================

/// Debug log event for development purposes only.
///
/// # Security Warning
///
/// This event is gated behind the `event-debug` feature flag and MUST NOT
/// be enabled in production builds. It can leak sensitive information
/// about pool operations.
#[cfg(feature = "event-debug")]
#[event]
pub struct DebugLog {
    pub pool: Pubkey,
    pub message: String,
    pub value: u64,
    pub timestamp: i64,
}

// =========================================================================
// HELPER MACROS FOR DEBUG LOGGING
// =========================================================================

/// Emit a debug log event (only when event-debug feature is enabled)
///
/// # Example
///
/// ```ignore
/// debug_log!(pool_config.key(), "Processing deposit", amount);
/// ```
#[macro_export]
#[cfg(feature = "event-debug")]
macro_rules! debug_log {
    ($pool:expr, $msg:expr, $val:expr) => {
        emit!(crate::events::DebugLog {
            pool: $pool,
            message: $msg.to_string(),
            value: $val,
            timestamp: Clock::get()?.unix_timestamp,
        });
    };
}

/// No-op version when event-debug is disabled
#[macro_export]
#[cfg(not(feature = "event-debug"))]
macro_rules! debug_log {
    ($pool:expr, $msg:expr, $val:expr) => {
        // Debug logging disabled in production - this is intentional
    };
}

#[event]
pub struct BatchProcessedEvent {
    pub pool: Pubkey,
    pub deposits_processed: u16,
    pub first_leaf_index: u32,
    pub last_leaf_index: u32,
    pub new_merkle_root: [u8; 32],
    pub timestamp: i64,
}
// =========================================================================
// TESTS
// =========================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deposit_event_is_privacy_preserving() {
        // Verify DepositMaspEvent doesn't have amount or depositor fields
        let event = DepositMaspEvent {
            pool: Pubkey::new_unique(),
            commitment: [1u8; 32],
            leaf_index: 0,
            merkle_root: [2u8; 32],
            asset_id: [3u8; 32],
            timestamp: 0,
        };
        // This compiles successfully, proving the struct has the expected shape
        assert_eq!(event.leaf_index, 0);
    }

    #[test]
    fn withdraw_event_is_privacy_preserving() {
        // Verify WithdrawMaspEvent doesn't have recipient or amount fields
        let event = WithdrawMaspEvent {
            pool: Pubkey::new_unique(),
            nullifier_hash: [1u8; 32],
            asset_id: [2u8; 32],
            relayer: Pubkey::new_unique(),
            relayer_fee: 1000,
            timestamp: 0,
        };
        // This compiles successfully, proving the struct has the expected shape
        // (no recipient or amount fields)
        assert_eq!(event.relayer_fee, 1000);
    }

    #[cfg(feature = "event-debug")]
    #[test]
    fn debug_events_exist_when_feature_enabled() {
        // This test only runs when event-debug feature is enabled
        let _deposit_debug = DepositMaspDebugEvent {
            pool: Pubkey::new_unique(),
            commitment: [0u8; 32],
            leaf_index: 0,
            amount: 1000,
            asset_id: [0u8; 32],
            depositor: Pubkey::new_unique(),
            has_encrypted_note: false,
            timestamp: 0,
        };

        let _withdraw_debug = WithdrawMaspDebugEvent {
            pool: Pubkey::new_unique(),
            nullifier_hash: [0u8; 32],
            recipient: Pubkey::new_unique(),
            amount: 1000,
            asset_id: [0u8; 32],
            relayer: Pubkey::new_unique(),
            relayer_fee: 100,
            timestamp: 0,
        };

        let _debug_log = DebugLog {
            pool: Pubkey::new_unique(),
            message: "test".to_string(),
            value: 42,
            timestamp: 0,
        };
    }

    #[test]
    fn joinsplit_event_structure() {
        let event = JoinSplitEvent {
            pool: Pubkey::new_unique(),
            input_count: 2,
            output_count: 2,
            nullifier_hash_0: [1u8; 32],
            nullifier_hash_1: [2u8; 32],
            output_commitment_0: [3u8; 32],
            output_commitment_1: [4u8; 32],
            public_amount: 0, // Internal transfer
            asset_id: [5u8; 32],
            relayer: Pubkey::new_unique(),
            relayer_fee: 500,
            output_leaf_indices: [100, 101],
            timestamp: 0,
        };
        assert_eq!(event.input_count, 2);
        assert_eq!(event.output_count, 2);
    }
}

/// Emitted when a batch of deposits is settled via off-chain proof
#[event]
pub struct BatchSettledEvent {
    pub pool: Pubkey,
    pub batch_size: u16,
    pub start_index: u32,
    pub new_root: [u8; 32],
    pub commitments_hash: [u8; 32],
    pub timestamp: i64,
}

// =========================================================================
// BATCH SETTLEMENT RECOVERY EVENTS
// =========================================================================

/// Emitted for EACH commitment inserted during batch settlement.
///
/// # Recovery Purpose
///
/// This event enables deterministic sequencer state recovery:
/// 1. Query all CommitmentInsertedEvent logs for the pool
/// 2. Sort by leaf_index
/// 3. Rebuild Merkle tree by inserting commitments in order
/// 4. Verify rebuilt root matches on-chain current_root
///
/// # Why Per-Commitment Events?
///
/// BatchSettledEvent only contains the commitments_hash (SHA256 of all commitments),
/// which is insufficient to rebuild tree state. This per-commitment event provides
/// the actual commitment values needed for reconstruction.
///
/// # Fields
///
/// - `commitment` - The actual commitment bytes (needed to rebuild tree)
/// - `leaf_index` - Position in tree (needed for ordering)
/// - `merkle_root` - Root after batch (same for all in batch, for verification)
#[event]
pub struct CommitmentInsertedEvent {
    /// Pool this commitment belongs to
    pub pool: Pubkey,
    /// The commitment hash (Poseidon(secret, nullifier, amount, asset))
    pub commitment: [u8; 32],
    /// Leaf index where this commitment was inserted
    pub leaf_index: u32,
    /// Merkle root after the batch containing this commitment
    pub merkle_root: [u8; 32],
    /// Unix timestamp when inserted
    pub timestamp: i64,
}
