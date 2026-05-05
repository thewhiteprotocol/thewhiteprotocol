use crate::error::WhiteProtocolError;
use crate::events::BridgeMessageFrozen;
use crate::state::bridge_frozen_message::FrozenBridgeMessage;
use crate::state::bridge_v1_config::BridgeV1Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(message_hash: [u8; 32], frozen: bool)]
pub struct FreezeBridgeV1Message<'info> {
    #[account(mut, constraint = bridge_v1_config.authority == authority.key() @ WhiteProtocolError::Unauthorized)]
    pub authority: Signer<'info>,

    pub bridge_v1_config: Account<'info, BridgeV1Config>,

    #[account(
        init_if_needed,
        payer = authority,
        space = FrozenBridgeMessage::LEN,
        seeds = [FrozenBridgeMessage::SEED_PREFIX, &message_hash],
        bump,
    )]
    pub frozen_message: Account<'info, FrozenBridgeMessage>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<FreezeBridgeV1Message>,
    message_hash: [u8; 32],
    frozen: bool,
) -> Result<()> {
    let frozen_msg = &mut ctx.accounts.frozen_message;
    let clock = Clock::get()?;

    frozen_msg.message_hash = message_hash;
    frozen_msg.frozen = frozen;
    frozen_msg.frozen_at = clock.unix_timestamp;
    if frozen_msg.bump == 0 {
        frozen_msg.bump = ctx.bumps.frozen_message;
    }

    emit!(BridgeMessageFrozen {
        message_hash,
        frozen,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
