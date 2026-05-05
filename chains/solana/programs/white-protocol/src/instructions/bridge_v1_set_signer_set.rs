use crate::error::WhiteProtocolError;
use crate::events::BridgeSignerSetUpdated;
use crate::state::bridge_signer_set::{BridgeSignerSet, MAX_SIGNERS};
use crate::state::bridge_v1_config::BridgeV1Config;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(version: u32, threshold: u8, signers: Vec<[u8; 20]>)]
pub struct SetBridgeV1SignerSet<'info> {
    #[account(mut, constraint = bridge_v1_config.authority == authority.key() @ WhiteProtocolError::Unauthorized)]
    pub authority: Signer<'info>,

    #[account(mut)]
    pub bridge_v1_config: Account<'info, BridgeV1Config>,

    #[account(
        init,
        payer = authority,
        space = BridgeSignerSet::LEN,
        seeds = [BridgeSignerSet::SEED_PREFIX, &version.to_le_bytes()],
        bump,
    )]
    pub signer_set: Account<'info, BridgeSignerSet>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SetBridgeV1SignerSet>,
    version: u32,
    threshold: u8,
    signers: Vec<[u8; 20]>,
) -> Result<()> {
    let config = &mut ctx.accounts.bridge_v1_config;
    let signer_set = &mut ctx.accounts.signer_set;
    let clock = Clock::get()?;

    // Validation
    if threshold == 0 {
        return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
    }

    let signer_count = signers.len();
    if signer_count == 0 {
        return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
    }
    if threshold as usize > signer_count {
        return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
    }
    if signer_count > MAX_SIGNERS {
        return Err(WhiteProtocolError::SignerSetTooLarge.into());
    }

    // No zero signers
    for s in &signers {
        if *s == [0u8; 20] {
            return Err(WhiteProtocolError::ZeroSigner.into());
        }
    }

    // No duplicates, sorted ascending
    for i in 1..signer_count {
        if signers[i] == signers[i - 1] {
            return Err(WhiteProtocolError::DuplicateSignerInSet.into());
        }
        if signers[i] < signers[i - 1] {
            return Err(WhiteProtocolError::InvalidBridgeSignerSet.into());
        }
    }

    // Populate signer set
    signer_set.version = version;
    signer_set.threshold = threshold;
    signer_set.signer_count = signer_count as u8;
    signer_set.signers = [[0u8; 20]; MAX_SIGNERS];
    for (i, s) in signers.iter().enumerate() {
        signer_set.signers[i] = *s;
    }
    signer_set.bump = ctx.bumps.signer_set;

    // Update config version
    config.signer_set_version = version;
    config.updated_at = clock.unix_timestamp;

    emit!(BridgeSignerSetUpdated {
        version,
        threshold,
        signer_count: signer_count as u8,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
