//! Mock OApp module for compilation without the LayerZero monorepo.
//!
//! Replace this entire module with:
//!   oapp = { path = ".../LayerZero-v2/packages/layerzero-v2/solana/programs/oapp" }
//!
//! This mock reproduces the exact CPI function signatures so the main program
//! compiles and the call sites are correct.

use anchor_lang::prelude::*;

pub const ID: Pubkey = anchor_lang::solana_program::pubkey!("oapp111111111111111111111111111111111111111");
pub const LZ_RECEIVE_TYPES_SEED: &[u8] = b"LzReceiveTypes";
pub const EVENT_SEED: &[u8] = b"__event_authority";

// ---------------------------------------------------------------------------
// Params structs (must match real oapp crate)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct RegisterOAppParams {
    pub delegate: Pubkey,
}

#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct ClearParams {
    pub receiver: Pubkey,
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub guid: [u8; 32],
    pub message: Vec<u8>,
}

#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct SendParams {
    pub dst_eid: u32,
    pub receiver: [u8; 32],
    pub message: Vec<u8>,
    pub options: Vec<u8>,
    pub native_fee: u64,
    pub lz_token_fee: u64,
}

// ---------------------------------------------------------------------------
// CPI helpers (mock — logs instead of real CPI)
// ---------------------------------------------------------------------------

pub mod endpoint_cpi {
    use super::*;

    pub fn register_oapp(
        _endpoint_program: Pubkey,
        _store: Pubkey,
        _remaining_accounts: &[AccountInfo],
        _seeds: &[&[u8]],
        _params: RegisterOAppParams,
    ) -> Result<()> {
        msg!("[MOCK] register_oapp called");
        Ok(())
    }

    pub fn clear(
        _endpoint_program: Pubkey,
        _store: Pubkey,
        _clear_accounts: &[AccountInfo],
        _seeds: &[&[u8]],
        _params: ClearParams,
    ) -> Result<()> {
        msg!("[MOCK] clear called");
        Ok(())
    }

    pub fn send(
        _endpoint_program: Pubkey,
        _store: Pubkey,
        _remaining_accounts: &[AccountInfo],
        _seeds: &[&[u8]],
        _params: SendParams,
    ) -> Result<()> {
        msg!("[MOCK] send called with dst_eid={}", _params.dst_eid);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// LzReceiveTypesV2 types (must match real oapp crate)
// ---------------------------------------------------------------------------

pub const LZ_RECEIVE_TYPES_VERSION: u8 = 2;
pub const EXECUTION_CONTEXT_VERSION_1: u8 = 1;

#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct LzReceiveTypesV2Accounts {
    pub accounts: Vec<Pubkey>,
}

#[derive(Clone, Debug)]
pub enum Instruction {
    LzReceive { accounts: Vec<u8> },
}

#[derive(Clone, Debug)]
pub struct LzReceiveTypesV2Result {
    pub context_version: u8,
    pub alts: Vec<Pubkey>,
    pub instructions: Vec<Instruction>,
}

impl AnchorSerialize for LzReceiveTypesV2Result {
    fn serialize<W: std::io::Write>(&self, _writer: &mut W) -> std::io::Result<()> {
        // Simplified serialization for mock
        Ok(())
    }
}

#[derive(Clone, Debug, AnchorSerialize, AnchorDeserialize)]
pub struct LzReceiveParams {
    pub src_eid: u32,
    pub sender: [u8; 32],
    pub nonce: u64,
    pub guid: [u8; 32],
    pub message: Vec<u8>,
}

#[account]
#[derive(InitSpace)]
pub struct LzReceiveTypesAccounts {
    pub store: Pubkey,
    pub bump: u8,
}

pub mod common {
    use super::*;

    #[derive(Clone, Debug)]
    pub struct AccountMetaRef {
        pub pubkey: AddressLocator,
        pub is_writable: bool,
    }

    #[derive(Clone, Debug)]
    pub enum AddressLocator {
        Payer,
        Address(Pubkey),
    }

    pub fn compact_accounts_with_alts(
        _alts: &[AccountInfo],
        accounts: Vec<AccountMetaRef>,
    ) -> Result<Vec<u8>> {
        let mut buf = Vec::new();
        for acc in accounts {
            match acc.pubkey {
                AddressLocator::Payer => buf.push(0),
                AddressLocator::Address(pk) => {
                    buf.push(1);
                    buf.extend_from_slice(&pk.to_bytes());
                }
            }
        }
        Ok(buf)
    }
}
