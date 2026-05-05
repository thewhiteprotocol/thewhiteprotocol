use crate::bridge::message_v1::{
    encode_bridge_message_v1, hash_bridge_message_v1, BridgeMessageV1, MESSAGE_TYPE_BRIDGE_OUT,
};
use crate::error::WhiteProtocolError;
use crate::events::BridgeOutInitiated;
use crate::state::bridge_asset_config::BridgeAssetConfig;
use crate::state::bridge_route_config::BridgeRouteConfig;
use crate::state::bridge_v1_config::BridgeV1Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(message: BridgeMessageV1)]
pub struct InitBridgeV1Out<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(mut)]
    pub bridge_v1_config: Account<'info, BridgeV1Config>,

    #[account(
        mut,
        seeds = [
            BridgeRouteConfig::SEED_PREFIX,
            &message.source_domain.to_le_bytes(),
            &message.destination_domain.to_le_bytes(),
        ],
        bump = route_config.bump,
    )]
    pub route_config: Account<'info, BridgeRouteConfig>,

    #[account(
        mut,
        seeds = [BridgeAssetConfig::SEED_PREFIX, &message.canonical_asset_id],
        bump = asset_config.bump,
    )]
    pub asset_config: Account<'info, BridgeAssetConfig>,
}

pub fn handler(ctx: Context<InitBridgeV1Out>, message: BridgeMessageV1) -> Result<()> {
    let config = &ctx.accounts.bridge_v1_config;
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
    if message.message_type != MESSAGE_TYPE_BRIDGE_OUT {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    // 3. Source domain == local
    if message.source_domain != config.domain_id {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    // 4. Destination != source
    if message.destination_domain == message.source_domain {
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

    // 9. Max message amount (asset-level)
    if message.amount > asset.max_message_amount {
        return Err(WhiteProtocolError::BridgeMaxAmountExceeded.into());
    }

    // 10. Max message amount (route-level)
    if message.amount > route.max_message_amount {
        return Err(WhiteProtocolError::BridgeMaxAmountExceeded.into());
    }

    // 11. Daily outflow cap (route)
    route.record_outflow(message.amount, now)?;

    // 12. Compute and record hash
    let message_hash = hash_bridge_message_v1(&message)?;

    // Note: outbound nonce tracking and duplicate hash prevention
    // are currently event-only in v1. The message itself carries the nonce.
    // Future PRs may add explicit nonce-account tracking.

    let encoded_message = encode_bridge_message_v1(&message)?;

    emit!(BridgeOutInitiated {
        message_hash,
        source_domain: message.source_domain,
        destination_domain: message.destination_domain,
        canonical_asset_id: message.canonical_asset_id,
        amount: message.amount,
        nonce: message.nonce,
        timestamp: now,
        encoded_message,
    });

    Ok(())
}
