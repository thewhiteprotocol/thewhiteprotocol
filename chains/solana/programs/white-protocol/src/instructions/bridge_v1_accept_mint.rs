use crate::bridge::attestation::verify_threshold_signatures;
use crate::bridge::message_v1::{
    hash_bridge_message_v1, BridgeMessageV1, MESSAGE_TYPE_BRIDGE_MINT,
};
use crate::error::WhiteProtocolError;
use crate::events::{BridgeMintAccepted, DepositQueuedEvent};
use crate::state::bridge_asset_config::BridgeAssetConfig;
use crate::state::bridge_consumed_message::ConsumedBridgeMessage;
use crate::state::bridge_frozen_message::FrozenBridgeMessage;
use crate::state::bridge_route_config::BridgeRouteConfig;
use crate::state::bridge_signer_set::BridgeSignerSet;
use crate::state::bridge_v1_config::BridgeV1Config;
use crate::state::{AssetVault, CommitmentIndex, MerkleTree, PendingDepositsBuffer, PoolConfig};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(message: BridgeMessageV1, signatures: Vec<[u8; 65]>, signer_set_version: u32)]
pub struct AcceptBridgeV1Mint<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut)]
    pub bridge_v1_config: Box<Account<'info, BridgeV1Config>>,

    #[account(
        seeds = [BridgeSignerSet::SEED_PREFIX, &signer_set_version.to_le_bytes()],
        bump = signer_set.bump,
    )]
    pub signer_set: Box<Account<'info, BridgeSignerSet>>,

    #[account(
        init,
        payer = caller,
        space = ConsumedBridgeMessage::LEN,
        seeds = [ConsumedBridgeMessage::SEED_PREFIX, &hash_bridge_message_v1(&message)?],
        bump,
    )]
    pub consumed_message: Box<Account<'info, ConsumedBridgeMessage>>,

    #[account(
        mut,
        seeds = [
            BridgeRouteConfig::SEED_PREFIX,
            &message.source_domain.to_le_bytes(),
            &message.destination_domain.to_le_bytes(),
        ],
        bump = route_config.bump,
    )]
    pub route_config: Box<Account<'info, BridgeRouteConfig>>,

    #[account(
        mut,
        seeds = [BridgeAssetConfig::SEED_PREFIX, &message.canonical_asset_id],
        bump = asset_config.bump,
    )]
    pub asset_config: Box<Account<'info, BridgeAssetConfig>>,

    /// CHECK: Optional frozen message PDA. If absent/uninitialized, the message is not frozen.
    /// If initialized, handler verifies owner, discriminator, message hash, and frozen flag.
    #[account(
        seeds = [FrozenBridgeMessage::SEED_PREFIX, &hash_bridge_message_v1(&message)?],
        bump,
    )]
    pub frozen_message: UncheckedAccount<'info>,

    // -------------------------------------------------------------------------
    // Pool accounts for commitment insertion
    // -------------------------------------------------------------------------
    #[account(
        mut,
        constraint = !pool_config.is_paused @ WhiteProtocolError::PoolPaused
    )]
    pub pool_config: Box<Account<'info, PoolConfig>>,

    #[account(
        mut,
        constraint = merkle_tree.pool == pool_config.key() @ WhiteProtocolError::InvalidMerkleTreePool
    )]
    pub merkle_tree: Box<Account<'info, MerkleTree>>,

    #[account(
        mut,
        seeds = [
            PendingDepositsBuffer::SEED_PREFIX,
            pool_config.key().as_ref(),
        ],
        bump = pending_buffer.bump,
        constraint = pending_buffer.pool == pool_config.key() @ WhiteProtocolError::InvalidPoolReference,
    )]
    pub pending_buffer: Box<Account<'info, PendingDepositsBuffer>>,

    #[account(
        mut,
        seeds = [
            AssetVault::SEED_PREFIX,
            pool_config.key().as_ref(),
            message.destination_local_asset_id.as_ref(),
        ],
        bump = asset_vault.bump,
        constraint = asset_vault.pool == pool_config.key() @ WhiteProtocolError::InvalidVaultPool,
        constraint = asset_vault.is_active @ WhiteProtocolError::AssetNotActive,
        constraint = asset_vault.deposits_enabled @ WhiteProtocolError::DepositsDisabled,
    )]
    pub asset_vault: Box<Account<'info, AssetVault>>,

    #[account(
        init,
        payer = caller,
        space = CommitmentIndex::LEN,
        seeds = [b"commitment", pool_config.key().as_ref(), message.destination_commitment.as_ref()],
        bump,
    )]
    pub commitment_index: Box<Account<'info, CommitmentIndex>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<AcceptBridgeV1Mint>,
    message: BridgeMessageV1,
    signatures: Vec<[u8; 65]>,
    signer_set_version: u32,
) -> Result<()> {
    let config = &ctx.accounts.bridge_v1_config;
    let signer_set = &ctx.accounts.signer_set;
    let route = &mut ctx.accounts.route_config;
    let asset = &mut ctx.accounts.asset_config;
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 1. Global pause
    if config.global_paused {
        return Err(WhiteProtocolError::BridgeRouteNotEnabled.into());
    }

    // 2. Protocol version and message type
    if message.protocol_version != 1 {
        return Err(WhiteProtocolError::InvalidInput.into());
    }
    if message.message_type != MESSAGE_TYPE_BRIDGE_MINT {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    // 3. Destination domain == local
    if message.destination_domain != config.domain_id {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    // 4. Source != destination
    if message.source_domain == message.destination_domain {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    // 5. Route enabled and not paused
    if !route.enabled {
        return Err(WhiteProtocolError::BridgeRouteNotEnabled.into());
    }
    if route.paused {
        return Err(WhiteProtocolError::BridgeRoutePaused.into());
    }

    // 6. Asset supported
    if !asset.supported {
        return Err(WhiteProtocolError::BridgeAssetNotSupported.into());
    }

    // 7. Amount > 0
    if message.amount == 0 {
        return Err(WhiteProtocolError::InvalidAmount.into());
    }

    // 8. Deadline
    if (message.deadline as i64) < now {
        return Err(WhiteProtocolError::BridgeDeadlineExpired.into());
    }

    // 9. Compute message hash
    let message_hash = hash_bridge_message_v1(&message)?;

    // 10. Message not frozen. The PDA is optional for normal messages.
    ensure_message_not_frozen(&ctx.accounts.frozen_message, &message_hash)?;

    // 11. Signer set version matches
    if signer_set_version != config.signer_set_version {
        return Err(WhiteProtocolError::SignerSetVersionMismatch.into());
    }

    // 12. Verify threshold signatures
    let signatures_slice: &[[u8; 65]] = &signatures;
    verify_threshold_signatures(&message_hash, signatures_slice, signer_set)?;

    // 13. Max message amount (asset)
    if message.amount > asset.max_message_amount {
        return Err(WhiteProtocolError::BridgeMaxAmountExceeded.into());
    }

    // 14. Max message amount (route)
    if message.amount > route.max_message_amount {
        return Err(WhiteProtocolError::BridgeMaxAmountExceeded.into());
    }

    // 15. Daily inflow cap (route)
    route.record_inflow(message.amount, now)?;

    // 16. Daily inflow cap (asset)
    asset.record_usage(message.amount, now)?;

    // -------------------------------------------------------------------------
    // 17. Insert destination commitment into pool pending buffer
    // -------------------------------------------------------------------------
    let merkle_tree: &MerkleTree = &*ctx.accounts.merkle_tree;
    let pending_buffer: &mut PendingDepositsBuffer = &mut *ctx.accounts.pending_buffer;
    let asset_vault: &mut AssetVault = &mut *ctx.accounts.asset_vault;
    let commitment = message.destination_commitment;

    // Validate commitment
    require!(
        !commitment.iter().all(|&b| b == 0),
        WhiteProtocolError::InvalidCommitment
    );
    require!(
        asset_vault.asset_id == message.destination_local_asset_id,
        WhiteProtocolError::AssetIdMismatch
    );
    require!(!merkle_tree.is_full(), WhiteProtocolError::MerkleTreeFull);

    // Enqueue commitment for batch settlement
    let available = merkle_tree.available_space() as usize;
    let pending = pending_buffer.size();
    require!(available > pending, WhiteProtocolError::MerkleTreeFull);

    for deposit in &pending_buffer.deposits {
        require!(
            deposit.commitment != commitment,
            WhiteProtocolError::CommitmentAlreadyExists
        );
    }

    let pending_index = pending_buffer.add_pending(commitment, now)?;
    let pending_count = pending_buffer.size();

    // Create commitment index PDA
    ctx.accounts.commitment_index.commitment = commitment;
    ctx.accounts.commitment_index.bump = ctx.bumps.commitment_index;

    // Update vault statistics
    // NOTE: amount is u128; asset_vault stats are u64.
    // The actual token transfer is handled by the bridge relayer / escrow.
    // We safely cast amount to u64 (bridge caps should prevent overflow).
    let amount_u64: u64 = message
        .amount
        .try_into()
        .map_err(|_| WhiteProtocolError::ArithmeticOverflow)?;
    asset_vault.record_deposit(amount_u64, now)?;

    emit!(DepositQueuedEvent {
        pool: ctx.accounts.pool_config.key(),
        commitment,
        asset_id: message.destination_local_asset_id,
        timestamp: now,
    });

    msg!(
        "BridgeV1Mint: commitment queued, pending_index={}, pending_count={}",
        pending_index,
        pending_count
    );

    // 18. Mark consumed
    let consumed = &mut ctx.accounts.consumed_message;
    consumed.message_hash = message_hash;
    consumed.source_domain = message.source_domain;
    consumed.destination_domain = message.destination_domain;
    consumed.nonce = message.nonce;
    consumed.consumed_at = now;
    consumed.bump = ctx.bumps.consumed_message;

    // 19. Emit bridge event
    emit!(BridgeMintAccepted {
        message_hash,
        source_domain: message.source_domain,
        destination_domain: message.destination_domain,
        canonical_asset_id: message.canonical_asset_id,
        amount: message.amount,
        destination_commitment: commitment,
        nonce: message.nonce,
        timestamp: now,
    });

    Ok(())
}

fn ensure_message_not_frozen(
    frozen_message: &UncheckedAccount,
    message_hash: &[u8; 32],
) -> Result<()> {
    let info = frozen_message.to_account_info();

    // Uninitialized optional PDA means no freeze record exists, so the message is not frozen.
    if info.data_is_empty() {
        return Ok(());
    }

    require_keys_eq!(*info.owner, crate::ID, WhiteProtocolError::InvalidInput);

    let data = info.try_borrow_data()?;
    let mut data_slice: &[u8] = &data;
    let frozen_msg = FrozenBridgeMessage::try_deserialize(&mut data_slice)
        .map_err(|_| WhiteProtocolError::CorruptedData)?;

    require!(
        frozen_msg.message_hash == *message_hash,
        WhiteProtocolError::InvalidInput
    );

    if frozen_msg.frozen {
        return Err(WhiteProtocolError::MessageIsFrozen.into());
    }

    Ok(())
}
