//! WhiteBridgeSolana — Proof-of-Concept
//!
//! Minimal Solana OApp demonstrating:
//! 1. OApp Store PDA registration with mock endpoint
//! 2. `bridge_out` instruction that CPIs `endpoint::send`
//! 3. `lz_receive` with peer validation and `endpoint::clear`
//! 4. `lz_receive_types_v2` account discovery
//! 5. Custom 52-byte bridge message codec

use anchor_lang::prelude::*;

mod mock_oapp;
use mock_oapp::*;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_SEED: &[u8] = b"Store";
const PEER_SEED: &[u8] = b"Peer";

// ---------------------------------------------------------------------------
// Program ID (replace with real keypair for deployment)
// ---------------------------------------------------------------------------

declare_id!("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

#[account]
#[derive(InitSpace)]
pub struct Store {
    pub endpoint_program: Pubkey,
    pub delegate: Pubkey,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct PeerConfig {
    pub peer_address: [u8; 32],
    pub bump: u8,
}

// ---------------------------------------------------------------------------
// Bridge Message Codec (52-byte compact format)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct BridgeMessage {
    pub canonical_asset: u32,
    pub amount: u64,
    pub new_commitment: [u8; 32],
    pub source_nonce: u64,
}

impl BridgeMessage {
    pub const LEN: usize = 4 + 8 + 32 + 8; // 52 bytes

    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::with_capacity(Self::LEN);
        buf.extend_from_slice(&self.canonical_asset.to_be_bytes());
        buf.extend_from_slice(&self.amount.to_be_bytes());
        buf.extend_from_slice(&self.new_commitment);
        buf.extend_from_slice(&self.source_nonce.to_be_bytes());
        buf
    }

    pub fn decode(buf: &[u8]) -> Result<Self> {
        require!(buf.len() >= Self::LEN, BridgeError::InvalidMessageLength);
        let canonical_asset = u32::from_be_bytes([buf[0], buf[1], buf[2], buf[3]]);
        let amount = u64::from_be_bytes([
            buf[4], buf[5], buf[6], buf[7], buf[8], buf[9], buf[10], buf[11],
        ]);
        let mut new_commitment = [0u8; 32];
        new_commitment.copy_from_slice(&buf[12..44]);
        let source_nonce = u64::from_be_bytes([
            buf[44], buf[45], buf[46], buf[47], buf[48], buf[49], buf[50], buf[51],
        ]);
        Ok(BridgeMessage {
            canonical_asset,
            amount,
            new_commitment,
            source_nonce,
        })
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum BridgeError {
    #[msg("Invalid message length")]
    InvalidMessageLength,
    #[msg("Peer not set")]
    PeerNotSet,
    #[msg("Invalid peer address")]
    InvalidPeer,
}

// ---------------------------------------------------------------------------
// Instructions
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct Init<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Store::INIT_SPACE,
        seeds = [STORE_SEED],
        bump
    )]
    pub store: Account<'info, Store>,
    #[account(
        init,
        payer = payer,
        space = 8 + LzReceiveTypesAccounts::INIT_SPACE,
        seeds = [LZ_RECEIVE_TYPES_SEED, store.key().as_ref()],
        bump
    )]
    pub lz_receive_types_accounts: Account<'info, LzReceiveTypesAccounts>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(eid: u32)]
pub struct SetPeer<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    #[account(
        init,
        payer = payer,
        space = 8 + PeerConfig::INIT_SPACE,
        seeds = [PEER_SEED, store.key().as_ref(), &eid.to_be_bytes()],
        bump
    )]
    pub peer: Account<'info, PeerConfig>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(dst_eid: u32)]
pub struct BridgeOut<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    #[account(
        seeds = [PEER_SEED, store.key().as_ref(), &dst_eid.to_be_bytes()],
        bump = peer.bump,
        constraint = peer.peer_address != [0u8; 32] @ BridgeError::PeerNotSet,
    )]
    pub peer: Account<'info, PeerConfig>,
}

#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceive<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    #[account(
        seeds = [PEER_SEED, store.key().as_ref(), &params.src_eid.to_be_bytes()],
        bump = peer.bump,
        constraint = params.sender == peer.peer_address @ BridgeError::InvalidPeer,
    )]
    pub peer: Account<'info, PeerConfig>,
}

#[derive(Accounts)]
pub struct LzReceiveTypesInfo<'info> {
    #[account(seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    #[account(seeds = [LZ_RECEIVE_TYPES_SEED, store.key().as_ref()], bump = lz_receive_types_accounts.bump)]
    pub lz_receive_types_accounts: Account<'info, LzReceiveTypesAccounts>,
}

#[derive(Accounts)]
#[instruction(params: LzReceiveParams)]
pub struct LzReceiveTypesV2<'info> {
    #[account(seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
}

// ---------------------------------------------------------------------------
// Program module
// ---------------------------------------------------------------------------

#[program]
pub mod white_bridge_solana {
    use super::*;

    pub fn init(ctx: Context<Init>, delegate: Pubkey) -> Result<()> {
        let store = &mut ctx.accounts.store;
        store.endpoint_program = ID; // In production: ENDPOINT_PROGRAM_ID
        store.delegate = delegate;
        store.bump = ctx.bumps.store;

        ctx.accounts.lz_receive_types_accounts.store = store.key();
        ctx.accounts.lz_receive_types_accounts.bump = ctx.bumps.lz_receive_types_accounts;

        let seeds: &[&[u8]] = &[STORE_SEED, &[store.bump]];
        endpoint_cpi::register_oapp(
            store.endpoint_program,
            store.key(),
            ctx.remaining_accounts,
            seeds,
            RegisterOAppParams { delegate },
        )?;
        Ok(())
    }

    pub fn set_peer(ctx: Context<SetPeer>, eid: u32, peer_address: [u8; 32]) -> Result<()> {
        let peer = &mut ctx.accounts.peer;
        peer.peer_address = peer_address;
        peer.bump = ctx.bumps.peer;
        msg!("Peer set for eid={} address={:?}", eid, peer_address);
        Ok(())
    }

    pub fn bridge_out(
        ctx: Context<BridgeOut>,
        dst_eid: u32,
        canonical_asset: u32,
        amount: u64,
        new_commitment: [u8; 32],
        source_nonce: u64,
        lz_options: Vec<u8>,
    ) -> Result<()> {
        let store = &ctx.accounts.store;
        let peer = &ctx.accounts.peer;

        let message = BridgeMessage {
            canonical_asset,
            amount,
            new_commitment,
            source_nonce,
        };
        let payload = message.encode();

        let seeds: &[&[u8]] = &[STORE_SEED, &[store.bump]];
        endpoint_cpi::send(
            store.endpoint_program,
            store.key(),
            ctx.remaining_accounts,
            seeds,
            SendParams {
                dst_eid,
                receiver: peer.peer_address,
                message: payload,
                options: lz_options,
                native_fee: 0,      // Would be quoted off-chain
                lz_token_fee: 0,
            },
        )?;

        msg!("BridgeOut: dst_eid={} canonical={} amount={}", dst_eid, canonical_asset, amount);
        Ok(())
    }

    pub fn lz_receive_types_info(
        ctx: Context<LzReceiveTypesInfo>,
        _params: LzReceiveParams,
    ) -> Result<(u8, LzReceiveTypesV2Accounts)> {
        let accounts = vec![ctx.accounts.store.key()];
        Ok((LZ_RECEIVE_TYPES_VERSION, LzReceiveTypesV2Accounts { accounts }))
    }

    pub fn lz_receive_types_v2(
        ctx: Context<LzReceiveTypesV2>,
        params: LzReceiveParams,
    ) -> Result<LzReceiveTypesV2Result> {
        let peer_seeds = [PEER_SEED, &params.src_eid.to_be_bytes()];
        let (peer, _) = Pubkey::find_program_address(&peer_seeds, ctx.program_id);

        let (event_authority, _) = Pubkey::find_program_address(&[EVENT_SEED], ctx.program_id);

        let accounts = vec![
            common::AccountMetaRef {
                pubkey: common::AddressLocator::Payer,
                is_writable: true,
            },
            common::AccountMetaRef {
                pubkey: common::AddressLocator::Address(peer),
                is_writable: false,
            },
            common::AccountMetaRef {
                pubkey: common::AddressLocator::Address(event_authority),
                is_writable: false,
            },
            common::AccountMetaRef {
                pubkey: common::AddressLocator::Address(anchor_lang::solana_program::system_program::ID),
                is_writable: false,
            },
            common::AccountMetaRef {
                pubkey: common::AddressLocator::Address(crate::ID),
                is_writable: false,
            },
        ];

        Ok(LzReceiveTypesV2Result {
            context_version: EXECUTION_CONTEXT_VERSION_1,
            alts: ctx.remaining_accounts.iter().map(|a| a.key()).collect(),
            instructions: vec![Instruction::LzReceive {
                accounts: common::compact_accounts_with_alts(&ctx.remaining_accounts, accounts)?,
            }],
        })
    }

    pub fn lz_receive(ctx: Context<LzReceive>, params: LzReceiveParams) -> Result<()> {
        let store = &ctx.accounts.store;
        let seeds: &[&[u8]] = &[STORE_SEED, &[store.bump]];

        // Call Endpoint::clear first (replay protection)
        let clear_accounts = &ctx.remaining_accounts[..ClearParams::MIN_ACCOUNTS_LEN];
        endpoint_cpi::clear(
            store.endpoint_program,
            store.key(),
            clear_accounts,
            seeds,
            ClearParams {
                receiver: store.key(),
                src_eid: params.src_eid,
                sender: params.sender,
                nonce: params.nonce,
                guid: params.guid,
                message: params.message.clone(),
            },
        )?;

        // Decode and process bridge message
        let message = BridgeMessage::decode(&params.message)?;
        msg!(
            "LzReceive: src_eid={} canonical={} amount={} nonce={}",
            params.src_eid,
            message.canonical_asset,
            message.amount,
            message.source_nonce,
        );

        // In production: CPI to White Protocol program for bridge_mint
        Ok(())
    }
}

// Placeholder for ClearParams::MIN_ACCOUNTS_LEN
impl ClearParams {
    pub const MIN_ACCOUNTS_LEN: usize = 0;
}
