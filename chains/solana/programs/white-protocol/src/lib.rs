#![allow(clippy::doc_lazy_continuation)]
#![allow(clippy::unwrap_or_default)]
#![allow(clippy::explicit_auto_deref)]
#![allow(clippy::manual_range_contains)]
#![allow(clippy::items_after_test_module)]
#![allow(clippy::needless_return)]
#![allow(clippy::redundant_slicing)]
#![allow(clippy::nonminimal_bool)]

use anchor_lang::prelude::*;

#[cfg(all(feature = "insecure-dev", not(debug_assertions)))]
compile_error!("insecure-dev cannot be enabled in release builds - this would deploy placeholder crypto to production");

#[cfg(all(feature = "event-debug", not(debug_assertions)))]
compile_error!("event-debug cannot be enabled in release builds - it leaks privacy-sensitive data");

pub mod crypto;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;
pub mod utils;

pub use instructions::*;

declare_id!("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");

pub(crate) use crate::instructions::admin::authority_v2::__client_accounts_accept_authority_transfer_v2;
pub(crate) use crate::instructions::admin::authority_v2::__client_accounts_cancel_authority_transfer_v2;
pub(crate) use crate::instructions::admin::authority_v2::__client_accounts_initiate_authority_transfer_v2;
pub(crate) use crate::instructions::admin::pause_v2::__client_accounts_pause_pool_v2;
pub(crate) use crate::instructions::admin::unpause_v2::__client_accounts_unpause_pool_v2;
pub(crate) use crate::instructions::batch_process_deposits::__client_accounts_batch_process_deposits;
pub(crate) use crate::instructions::deposit_masp::__client_accounts_deposit_masp;
pub(crate) use crate::instructions::initialize_pool_registries::__client_accounts_initialize_pool_registries;
pub(crate) use crate::instructions::initialize_pool_v2::__client_accounts_initialize_pool_v2;
pub(crate) use crate::instructions::register_asset::__client_accounts_register_asset;
pub(crate) use crate::instructions::relayer::configure_registry::__client_accounts_configure_relayer_registry;
pub(crate) use crate::instructions::relayer::deactivate_relayer::__client_accounts_deactivate_relayer;
pub(crate) use crate::instructions::relayer::register_relayer::__client_accounts_register_relayer;
pub(crate) use crate::instructions::relayer::update_relayer::__client_accounts_update_relayer;
pub(crate) use crate::instructions::set_verification_key_chunked::__client_accounts_append_vk_ic_v2;
pub(crate) use crate::instructions::set_verification_key_chunked::__client_accounts_close_vk_v2;
pub(crate) use crate::instructions::set_verification_key_chunked::__client_accounts_finalize_vk_v2;
pub(crate) use crate::instructions::set_verification_key_chunked::__client_accounts_initialize_vk_v2;
pub(crate) use crate::instructions::set_verification_key_v2::__client_accounts_lock_verification_key_v2;
pub(crate) use crate::instructions::set_verification_key_v2::__client_accounts_set_verification_key_v2;
pub(crate) use crate::instructions::withdraw_masp::__client_accounts_withdraw_masp;
pub(crate) use crate::instructions::withdraw_masp::__client_accounts_withdraw_masp_stealth;
pub(crate) use crate::instructions::withdraw_yield_v2::__client_accounts_withdraw_yield_v2;
pub(crate) use crate::instructions::init_yield_registry::__client_accounts_init_yield_registry;
pub(crate) use crate::instructions::manage_yield_mints::__client_accounts_manage_yield_mints;
pub(crate) use crate::instructions::set_feature_flags::__client_accounts_set_feature_flags;
pub(crate) use crate::instructions::withdraw_v2::__client_accounts_withdraw_v2;
pub(crate) use crate::instructions::admin::clear_pending::__client_accounts_clear_pending_buffer;
pub(crate) use crate::instructions::admin::reset_merkle::__client_accounts_reset_merkle_tree;

#[program]
pub mod white_protocol {
    use super::*;

    pub fn initialize_pool_v2(
        ctx: Context<InitializePoolV2>,
        tree_depth: u8,
        root_history_size: u16,
    ) -> Result<()> {
        instructions::initialize_pool_v2::handler(ctx, tree_depth, root_history_size)
    }

    pub fn initialize_pool_registries(ctx: Context<InitializePoolRegistries>) -> Result<()> {
        instructions::initialize_pool_registries::handler(ctx)
    }

    pub fn initialize_pending_deposits_buffer(
        ctx: Context<InitializePendingDepositsBuffer>,
    ) -> Result<()> {
        instructions::initialize_pending_deposits_buffer::handler(ctx)
    }

    pub fn register_asset(ctx: Context<RegisterAsset>, asset_id: [u8; 32]) -> Result<()> {
        instructions::register_asset::handler(ctx, asset_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_verification_key_v2(
        ctx: Context<SetVerificationKeyV2>,
        proof_type: ProofType,
        vk_alpha_g1: [u8; 64],
        vk_beta_g2: [u8; 128],
        vk_gamma_g2: [u8; 128],
        vk_delta_g2: [u8; 128],
        vk_ic: Vec<[u8; 64]>,
    ) -> Result<()> {
        instructions::set_verification_key_v2::handler(
            ctx,
            proof_type,
            vk_alpha_g1,
            vk_beta_g2,
            vk_gamma_g2,
            vk_delta_g2,
            vk_ic,
        )
    }

    pub fn lock_verification_key_v2(
        ctx: Context<LockVerificationKeyV2>,
        proof_type: ProofType,
    ) -> Result<()> {
        instructions::set_verification_key_v2::lock_handler(ctx, proof_type)
    }

    /// Initialize VK with base curve points (chunked upload step 1)
    pub fn initialize_vk_v2(
        ctx: Context<InitializeVkV2>,
        proof_type: ProofType,
        vk_alpha_g1: [u8; 64],
        vk_beta_g2: [u8; 128],
        vk_gamma_g2: [u8; 128],
        vk_delta_g2: [u8; 128],
        expected_ic_count: u8,
    ) -> Result<()> {
        instructions::set_verification_key_chunked::initialize_vk_handler(
            ctx,
            proof_type,
            vk_alpha_g1,
            vk_beta_g2,
            vk_gamma_g2,
            vk_delta_g2,
            expected_ic_count,
        )
    }

    /// Append IC points to VK (chunked upload step 2, can call multiple times)
    pub fn append_vk_ic_v2(
        ctx: Context<AppendVkIcV2>,
        proof_type: ProofType,
        ic_points: Vec<[u8; 64]>,
    ) -> Result<()> {
        instructions::set_verification_key_chunked::append_vk_ic_handler(ctx, proof_type, ic_points)
    }

    /// Finalize VK after all IC points uploaded (chunked upload step 3)
    pub fn finalize_vk_v2(ctx: Context<FinalizeVkV2>, proof_type: ProofType) -> Result<()> {
        instructions::set_verification_key_chunked::finalize_vk_handler(ctx, proof_type)
    }

    /// Close VK account - allows authority to delete a VK to fix mistakes
    pub fn close_vk_v2(ctx: Context<CloseVkV2>, proof_type: ProofType) -> Result<()> {
        instructions::set_verification_key_chunked::close_vk_handler(ctx, proof_type)
    }

    pub fn pause_pool_v2(ctx: Context<PausePoolV2>) -> Result<()> {
        instructions::admin::pause_v2::handler(ctx)
    }

    pub fn unpause_pool_v2(ctx: Context<UnpausePoolV2>) -> Result<()> {
        instructions::admin::unpause_v2::handler(ctx)
    }

    /// Admin: Clear pending deposits buffer (emergency/testing)
    pub fn clear_pending_buffer(ctx: Context<ClearPendingBuffer>) -> Result<()> {
        instructions::admin::clear_pending::handler(ctx)
    }

    /// Admin: Reset merkle tree to empty state
    pub fn reset_merkle_tree(ctx: Context<ResetMerkleTree>) -> Result<()> {
        instructions::admin::reset_merkle::handler(ctx)
    }

    pub fn initiate_authority_transfer_v2(
        ctx: Context<InitiateAuthorityTransferV2>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::admin::authority_v2::initiate_handler(ctx, new_authority)
    }

    pub fn accept_authority_transfer_v2(ctx: Context<AcceptAuthorityTransferV2>) -> Result<()> {
        instructions::admin::authority_v2::accept_handler(ctx)
    }

    pub fn cancel_authority_transfer_v2(ctx: Context<CancelAuthorityTransferV2>) -> Result<()> {
        instructions::admin::authority_v2::cancel_handler(ctx)
    }

    pub fn configure_relayer_registry(
        ctx: Context<ConfigureRelayerRegistry>,
        min_fee_bps: u16,
        max_fee_bps: u16,
        require_stake: bool,
        min_stake_amount: u64,
    ) -> Result<()> {
        instructions::relayer::configure_registry::handler(
            ctx,
            min_fee_bps,
            max_fee_bps,
            require_stake,
            min_stake_amount,
        )
    }

    pub fn register_relayer(
        ctx: Context<RegisterRelayer>,
        fee_bps: u16,
        metadata_uri: String,
    ) -> Result<()> {
        instructions::relayer::register_relayer::handler(ctx, fee_bps, metadata_uri)
    }

    pub fn update_relayer(
        ctx: Context<UpdateRelayer>,
        fee_bps: Option<u16>,
        metadata_uri: Option<String>,
        is_active: Option<bool>,
    ) -> Result<()> {
        instructions::relayer::update_relayer::handler(ctx, fee_bps, metadata_uri, is_active)
    }

    pub fn deactivate_relayer(ctx: Context<DeactivateRelayer>) -> Result<()> {
        instructions::relayer::deactivate_relayer::handler(ctx)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn deposit_masp(
        ctx: Context<DepositMasp>,
        amount: u64,
        commitment: [u8; 32],
        asset_id: [u8; 32],
        proof_data: Vec<u8>,
        encrypted_note: Option<Vec<u8>>,
    ) -> Result<()> {
        instructions::deposit_masp::handler(
            ctx,
            amount,
            commitment,
            asset_id,
            proof_data,
            encrypted_note,
        )
    }

    pub fn batch_process_deposits(
        ctx: Context<BatchProcessDeposits>,
        max_to_process: u16,
    ) -> Result<()> {
        instructions::batch_process_deposits::handler(ctx, max_to_process)
    }

    /// Settle a batch of deposits using off-chain ZK proof.
    ///
    /// Production-grade: verifies Groth16 proof instead of on-chain Merkle insertion.
    pub fn settle_deposits_batch(
        ctx: Context<SettleDepositsBatch>,
        args: SettleDepositsBatchArgs,
    ) -> Result<()> {
        instructions::settle_deposits_batch::handler(ctx, args)
    }

    /// Withdraw tokens from the shielded pool using a ZK proof.
    ///
    /// # Security
    /// - Verifies ZK proof proving knowledge of commitment preimage
    /// - Checks merkle root is valid (current or in history)
    /// - Marks nullifier as spent to prevent double-spending
    /// - Enforces recipient_token_account.owner == recipient (from proof public inputs)
    /// - Enforces relayer_token_account.owner == relayer (from proof public inputs)
    #[allow(clippy::too_many_arguments)]
    pub fn withdraw_masp(
        ctx: Context<WithdrawMasp>,
        proof_data: Vec<u8>,
        merkle_root: [u8; 32],
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        amount: u64,
        asset_id: [u8; 32],
        relayer_fee: u64,
    ) -> Result<()> {
        instructions::withdraw_masp::handler(
            ctx,
            proof_data,
            merkle_root,
            nullifier_hash,
            recipient,
            amount,
            asset_id,
            relayer_fee,
        )
    }

    /// Withdraw MASP with stealth address support
    #[allow(clippy::too_many_arguments)]
    pub fn withdraw_masp_stealth(
        ctx: Context<WithdrawMaspStealth>,
        proof_data: Vec<u8>,
        merkle_root: [u8; 32],
        nullifier_hash: [u8; 32],
        recipient: Pubkey,
        amount: u64,
        asset_id: [u8; 32],
        relayer_fee: u64,
        ephemeral_pubkey: [u8; 32],
    ) -> Result<()> {
        instructions::withdraw_masp::handler_stealth(
            ctx,
            proof_data,
            merkle_root,
            nullifier_hash,
            recipient,
            amount,
            asset_id,
            relayer_fee,
            ephemeral_pubkey,
        )
    }

    /// Withdraw V2 (join-split with change output)
    #[allow(clippy::too_many_arguments)]
    pub fn withdraw_v2(
        ctx: Context<WithdrawV2>,
        proof_data: Vec<u8>,
        merkle_root: [u8; 32],
        asset_id: [u8; 32],
        nullifier_hash_0: [u8; 32],
        nullifier_hash_1: [u8; 32],
        change_commitment: [u8; 32],
        recipient: Pubkey,
        amount: u64,
        relayer_fee: u64,
    ) -> Result<()> {
        instructions::withdraw_v2::handler(
            ctx,
            proof_data,
            merkle_root,
            asset_id,
            nullifier_hash_0,
            nullifier_hash_1,
            change_commitment,
            recipient,
            amount,
            relayer_fee,
        )
    }

    /// Withdraw Yield V2 - Yield Mode with 5% performance fee
    ///
    /// Gated by yield_relayer signer for fee enforcement on positive yield
    #[allow(clippy::too_many_arguments)]
    pub fn withdraw_yield_v2(
        ctx: Context<WithdrawYieldV2>,
        proof_data: Vec<u8>,
        merkle_root: [u8; 32],
        asset_id: [u8; 32],
        nullifier_hash_0: [u8; 32],
        nullifier_hash_1: [u8; 32],
        change_commitment: [u8; 32],
        recipient: Pubkey,
        amount: u64,
        relayer_fee: u64,
    ) -> Result<()> {
        instructions::withdraw_yield_v2::handler(
            ctx,
            proof_data,
            merkle_root,
            asset_id,
            nullifier_hash_0,
            nullifier_hash_1,
            change_commitment,
            recipient,
            amount,
            relayer_fee,
        )
    }

    /// Initialize Yield Registry
    pub fn init_yield_registry(ctx: Context<InitYieldRegistry>) -> Result<()> {
        instructions::init_yield_registry::handler(ctx)
    }

    /// Add a yield mint to the registry
    pub fn add_yield_mint(ctx: Context<ManageYieldMints>, mint: Pubkey) -> Result<()> {
        instructions::manage_yield_mints::add_yield_mint(ctx, mint)
    }

    /// Remove a yield mint from the registry
    pub fn remove_yield_mint(ctx: Context<ManageYieldMints>, mint: Pubkey) -> Result<()> {
        instructions::manage_yield_mints::remove_yield_mint(ctx, mint)
    }

    /// Enable a feature flag (authority only)
    pub fn enable_feature(ctx: Context<SetFeatureFlags>, feature: u8) -> Result<()> {
        instructions::set_feature_flags::enable_feature(ctx, feature)
    }

    /// Disable a feature flag (authority only)
    pub fn disable_feature(ctx: Context<SetFeatureFlags>, feature: u8) -> Result<()> {
        instructions::set_feature_flags::disable_feature(ctx, feature)
    }

}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProofType {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3,
    MerkleBatchUpdate = 4,
    WithdrawV2 = 5,
}

impl ProofType {
    pub fn as_seed(&self) -> &[u8] {
        match self {
            ProofType::Deposit => b"vk_deposit",
            ProofType::Withdraw => b"vk_withdraw",
            ProofType::JoinSplit => b"vk_joinsplit",
            ProofType::Membership => b"vk_membership",
            ProofType::MerkleBatchUpdate => b"vk_merkle_batch",
            ProofType::WithdrawV2 => b"vk_withdraw_v2",
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ShieldedActionType {
    DexSwap = 0,
    LendingDeposit = 1,
    LendingBorrow = 2,
    Stake = 3,
    Unstake = 4,
    Custom = 255,
}

pub use error::WhiteProtocolError;
pub use events::*;
pub use state::{
    AssetVault, ComplianceConfig, MerkleTree, PoolConfig, RelayerNode, RelayerRegistry,
    SpentNullifier, VerificationKeyAccount,
};
