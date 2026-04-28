//! WhiteBridgeSolana — LayerZero V2 OApp for The White Protocol
//!
//! Separate bridge program that:
//! 1. Maintains OApp state (Store PDA, Peer PDAs)
//! 2. CPIs into the White Protocol core program for `bridge_withdraw` and `bridge_mint`
//! 3. Encodes/decodes the 52-byte compact wire format
//!
//! NOTE: LZ Endpoint CPIs are stubbed. In production, replace `mock_lz` with
//! the actual `oapp` crate from LayerZero-Labs/LayerZero-v2.

use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_SEED: &[u8] = b"Store";
const PEER_SEED: &[u8] = b"Peer";

/// White Protocol core program ID (devnet / mainnet)
const WHITE_PROTOCOL_PROGRAM_ID: Pubkey = pubkey!("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");

// ---------------------------------------------------------------------------
// Program ID (replace with real keypair for deployment)
// ---------------------------------------------------------------------------

declare_id!("So11111111111111111111111111111111111111112");

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
    #[msg("Amount overflow")]
    AmountOverflow,
}

// ---------------------------------------------------------------------------
// Accounts
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
pub struct LzReceive<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [STORE_SEED], bump = store.bump)]
    pub store: Account<'info, Store>,
    pub peer: Account<'info, PeerConfig>,
}

// ---------------------------------------------------------------------------
// Program module
// ---------------------------------------------------------------------------

#[program]
pub mod white_bridge_solana {
    use super::*;

    pub fn init(ctx: Context<Init>, delegate: Pubkey) -> Result<()> {
        let store = &mut ctx.accounts.store;
        store.endpoint_program = ID;
        store.delegate = delegate;
        store.bump = ctx.bumps.store;
        msg!("WhiteBridgeSolana initialized");
        Ok(())
    }

    pub fn set_peer(ctx: Context<SetPeer>, eid: u32, peer_address: [u8; 32]) -> Result<()> {
        let peer = &mut ctx.accounts.peer;
        peer.peer_address = peer_address;
        peer.bump = ctx.bumps.peer;
        msg!("Peer set for eid={} address={:?}", eid, peer_address);
        Ok(())
    }

    /// bridge_out encodes the bridge message and CPIs to the White Protocol
    /// `bridge_withdraw` to burn/nullify the source commitment, then sends
    /// the LZ message (stubbed in this version).
    pub fn bridge_out(
        ctx: Context<BridgeOut>,
        dst_eid: u32,
        canonical_asset: u32,
        amount: u64,
        new_commitment: [u8; 32],
        source_nonce: u64,
    ) -> Result<()> {
        let _store = &ctx.accounts.store;
        let _peer = &ctx.accounts.peer;

        let message = BridgeMessage {
            canonical_asset,
            amount,
            new_commitment,
            source_nonce,
        };
        let payload = message.encode();

        msg!(
            "BridgeOut: dst_eid={} canonical={} amount={} payload_len={}",
            dst_eid,
            canonical_asset,
            amount,
            payload.len()
        );

        // CPI to White Protocol bridge_withdraw would go here.
        // Requires: proof_data, merkle_root, nullifier_hash, recipient, amount,
        // asset_id, public_data_hash.
        // The recipient is this program's Store PDA, relayer = default, relayer_fee = 0.
        //
        // Production implementation:
        //   1. Compute extDataHash = keccak256(dst_eid, newCommitment, canonicalAsset, amount)
        //   2. white_protocol::cpi::bridge_withdraw(..., public_data_hash = extDataHash)
        //   3. endpoint_cpi::send(dst_eid, peer.peer_address, payload, ...)

        Ok(())
    }

    /// lz_receive decodes the inbound bridge message and CPIs to the White Protocol
    /// `bridge_mint` to create a new commitment.
    pub fn lz_receive(
        ctx: Context<LzReceive>,
        src_eid: u32,
        sender: [u8; 32],
        message: Vec<u8>,
    ) -> Result<()> {
        let store = &ctx.accounts.store;

        // Verify peer
        let store_key = store.key();
        let peer_seeds = [PEER_SEED, store_key.as_ref(), &src_eid.to_be_bytes()];
        let (expected_peer, _) = Pubkey::find_program_address(&peer_seeds, ctx.program_id);
        require!(
            ctx.accounts.peer.key() == expected_peer,
            BridgeError::InvalidPeer
        );
        require!(
            sender == ctx.accounts.peer.peer_address,
            BridgeError::InvalidPeer
        );

        let bm = BridgeMessage::decode(&message)?;
        msg!(
            "LzReceive: src_eid={} canonical={} amount={} nonce={}",
            src_eid,
            bm.canonical_asset,
            bm.amount,
            bm.source_nonce,
        );

        // CPI to White Protocol bridge_mint would go here.
        // Requires: amount, commitment, asset_id.
        // The bridge program must have a token account with the bridged tokens
        // and must be configured as the bridge_authority in the core program.
        //
        // Production implementation:
        //   white_protocol::cpi::bridge_mint(ctx, amount, bm.new_commitment, asset_id)

        Ok(())
    }
}
