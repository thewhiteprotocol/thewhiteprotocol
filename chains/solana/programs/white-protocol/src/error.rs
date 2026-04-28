use anchor_lang::prelude::*;

#[error_code]
pub enum WhiteProtocolError {
    // =========================================================================
    // PROOF & CRYPTOGRAPHY ERRORS
    // =========================================================================
    #[msg("Invalid proof: verification failed")]
    InvalidProof,

    #[msg("Invalid proof format: expected 256 bytes")]
    InvalidProofFormat,

    #[msg("Invalid public inputs for proof verification")]
    InvalidPublicInputs,

    #[msg("Verification key not configured for this proof type")]
    VerificationKeyNotSet,

    #[msg("Verification key is locked and cannot be modified")]
    VerificationKeyLocked,
    #[msg("Verification key already finalized")]
    VkAlreadyFinalized,

    #[msg("Proof type not supported")]
    UnsupportedProofType,

    #[msg("Circuit not implemented: proof verification unavailable")]
    ProofNotImplemented,

    #[msg("VK IC length mismatch for proof type")]
    VkIcLengthMismatch,

    #[msg("Cryptographic operation failed")]
    CryptographyError,

    #[msg("Invalid verification key pool reference")]
    InvalidVerificationKeyPool,

    #[msg("Invalid verification key type for this operation")]
    InvalidVerificationKeyType,

    // NEW: From security fixes
    #[msg(
        "Cryptography not implemented - build with --features insecure-dev for local testing only"
    )]
    CryptoNotImplemented,

    #[msg("Proof verification failed - invalid zero-knowledge proof")]
    ProofVerificationFailedInvalid,

    // =========================================================================
    // MERKLE TREE ERRORS
    // =========================================================================
    #[msg("Merkle root not in recent history")]
    InvalidMerkleRoot,

    #[msg("Merkle tree is full")]
    MerkleTreeFull,

    #[msg("Tree depth must be between 4 and 24")]
    InvalidTreeDepth,

    #[msg("Root history size must be at least 30")]
    InvalidRootHistorySize,

    #[msg("Invalid Merkle tree pool reference")]
    InvalidMerkleTreePool,

    #[msg("Leaf index does not exist in Merkle tree")]
    LeafIndexNotFound,

    #[msg("Invalid pool reference")]
    InvalidPoolReference,
    #[msg("Nullifier already spent")]
    NullifierAlreadySpent,

    #[msg("Invalid nullifier: cannot be all zeros")]
    InvalidNullifier,

    #[msg("Invalid ephemeral pubkey: cannot be all zeros")]
    InvalidEphemeralPubkey,

    #[msg("Too many nullifiers for join-split (max 4)")]
    TooManyNullifiers,

    #[msg("Duplicate nullifier in input set")]
    DuplicateNullifier,

    // =========================================================================
    // AMOUNT/VALUE ERRORS
    // =========================================================================
    #[msg("Invalid address: cannot be default / zero pubkey")]
    InvalidAddress,

    #[msg("Invalid amount: must be greater than zero")]
    InvalidAmount,

    #[msg("Insufficient vault balance")]
    InsufficientBalance,

    #[msg("Relayer fee exceeds withdrawal amount")]
    RelayerFeeExceedsAmount,

    #[msg("Amount below minimum deposit")]
    BelowMinimumDeposit,

    #[msg("Amount exceeds maximum deposit")]
    ExceedsMaximumDeposit,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Join-split value conservation failed")]
    ValueConservationFailed,

    // =========================================================================
    // ASSET ERRORS
    // =========================================================================
    #[msg("Token mint does not match pool configuration")]
    InvalidMint,

    #[msg("Asset not registered with pool")]
    AssetNotRegistered,

    #[msg("Asset is not active")]
    AssetNotActive,

    #[msg("Too many assets registered")]
    TooManyAssets,

    #[msg("Asset ID mismatch")]
    AssetIdMismatch,

    #[msg("Deposits are disabled for this asset")]
    DepositsDisabled,

    #[msg("Withdrawals are disabled for this asset")]
    WithdrawalsDisabled,

    #[msg("Invalid asset ID: cannot be all zeros")]
    InvalidAssetId,

    #[msg("Invalid vault pool reference")]
    InvalidVaultPool,

    #[msg("Invalid vault token account")]
    InvalidVaultTokenAccount,

    // =========================================================================
    // COMMITMENT ERRORS
    // =========================================================================
    #[msg("Invalid commitment: cannot be all zeros")]
    InvalidCommitment,

    #[msg("Too many output commitments for join-split (max 4)")]
    TooManyOutputs,

    #[msg("Duplicate commitment in output set")]
    DuplicateCommitment,

    // =========================================================================
    // AUTHORIZATION ERRORS
    // =========================================================================
    #[msg("Unauthorized: caller is not pool authority")]
    Unauthorized,

    #[msg("Invalid authority address")]
    InvalidAuthority,

    #[msg("No pending authority transfer")]
    NoPendingAuthority,

    #[msg("Recipient does not match proof public inputs")]
    RecipientMismatch,
    #[msg("Required account is missing")]
    MissingAccount,

    #[msg("Relayer token account owner does not match relayer signer")]
    RelayerMismatch,

    #[msg("Invalid token owner")]
    InvalidTokenOwner,

    // =========================================================================
    // RELAYER ERRORS
    // =========================================================================
    #[msg("Relayer not registered")]
    RelayerNotRegistered,

    #[msg("Relayer not active")]
    RelayerNotActive,

    #[msg("Relayer fee out of allowed range")]
    RelayerFeeOutOfRange,

    #[msg("Relayer fee calculation overflow - fee is unreasonably large")]
    RelayerFeeOverflow,

    #[msg("Invalid fee configuration")]
    InvalidFeeConfiguration,

    #[msg("Relayer registrations are closed")]
    RegistrationsClosed,

    #[msg("Insufficient relayer stake")]
    InsufficientStake,

    #[msg("Invalid RelayerNode PDA: derivation does not match expected seeds")]
    InvalidRelayerNodePda,

    #[msg("RelayerNode registry mismatch: node does not belong to expected registry")]
    RelayerNodeRegistryMismatch,

    // =========================================================================
    // STATE ERRORS
    // =========================================================================
    #[msg("Pool is paused")]
    PoolPaused,

    #[msg("Pool is not paused")]
    PoolNotPaused,

    #[msg("Pool is not active")]
    PoolInactive,

    #[msg("Account already initialized")]
    AlreadyInitialized,

    #[msg("Account data corrupted")]
    CorruptedData,

    #[msg("Invalid metadata format or content")]
    InvalidMetadata,

    #[msg("Invalid input parameter")]
    InvalidInput,

    #[msg("Operation exceeds safe limits")]
    LimitExceeded,

    #[msg("Invalid timestamp")]
    InvalidTimestamp,

    // =========================================================================
    // BATCHING ERRORS (NEW - from security fixes)
    // =========================================================================
    #[msg("Pending deposits buffer is full")]
    BufferFull,

    #[msg("No pending deposits to process")]
    NoPendingDeposits,

    #[msg("Batch not ready for processing - timing constraints not met")]
    BatchNotReady,

    #[msg("Invalid batch size - must be between 1 and MAX_BATCH_SIZE")]
    InvalidBatchSize,

    // =========================================================================
    // FEATURE ERRORS
    // =========================================================================
    #[msg("Feature not enabled for this pool")]
    FeatureDisabled,

    #[msg("Feature not implemented in this version")]
    NotImplemented,

    #[msg("Join-split not enabled")]
    JoinSplitDisabled,

    #[msg("Membership proofs not enabled")]
    MembershipProofsDisabled,

    #[msg("Shielded CPI not enabled")]
    ShieldedCpiDisabled,

    // =========================================================================
    // COMPLIANCE ERRORS
    // =========================================================================
    #[msg("Encrypted note required for this pool")]
    EncryptedNoteRequired,

    #[msg("Invalid encrypted note format")]
    InvalidEncryptedNote,

    #[msg("Audit metadata already attached")]
    MetadataAlreadyAttached,

    // =========================================================================
    // INPUT VALIDATION
    // =========================================================================
    #[msg("Input exceeds maximum allowed length")]
    InputTooLarge,

    #[msg("Invalid account owner")]
    InvalidOwner,

    #[msg("Invalid account discriminator")]
    InvalidDiscriminator,

    // =========================================================================
    // CPI ERRORS
    // =========================================================================
    #[msg("Shielded action not supported")]
    UnsupportedShieldedAction,

    #[msg("CPI call failed")]
    CpiCallFailed,

    #[msg("Invalid action data")]
    InvalidActionData,

    // ========================================================================
    // Yield Mode Errors
    // ========================================================================
    #[msg("Yield asset must use withdraw_yield_v2 instruction")]
    YieldAssetRequiresYieldExit,

    #[msg("Maximum yield mints exceeded")]
    YieldMintsExceeded,

    #[msg("Yield mint already exists in registry")]
    YieldMintAlreadyExists,

    #[msg("Yield mint not found in registry")]
    YieldMintNotFound,

    #[msg("Non-yield asset cannot use yield exit")]
    NonYieldAssetCannotUseYieldExit,

    #[msg("Yield registry required when yield enforcement is enabled")]
    YieldRegistryRequired,
    #[msg("Invalid feature flag")]
    InvalidFeatureFlag,
    #[msg("Cannot disable core feature")]
    CannotDisableCoreFeature,

    #[msg("Commitment already exists in pending buffer or Merkle tree")]
    CommitmentAlreadyExists,
}

impl WhiteProtocolError {
    /// Check if error is related to proof verification
    pub fn is_proof_error(&self) -> bool {
        matches!(
            self,
            WhiteProtocolError::InvalidProof
                | WhiteProtocolError::InvalidProofFormat
                | WhiteProtocolError::InvalidPublicInputs
                | WhiteProtocolError::VerificationKeyNotSet
                | WhiteProtocolError::CryptographyError
                | WhiteProtocolError::CryptoNotImplemented
                | WhiteProtocolError::ProofVerificationFailedInvalid
        )
    }

    /// Check if error is related to authorization
    pub fn is_auth_error(&self) -> bool {
        matches!(
            self,
            WhiteProtocolError::Unauthorized
                | WhiteProtocolError::InvalidAuthority
                | WhiteProtocolError::InvalidTokenOwner
        )
    }

    /// Check if error is related to pool state
    pub fn is_state_error(&self) -> bool {
        matches!(
            self,
            WhiteProtocolError::PoolPaused
                | WhiteProtocolError::PoolNotPaused
                | WhiteProtocolError::PoolInactive
                | WhiteProtocolError::AlreadyInitialized
        )
    }
}
