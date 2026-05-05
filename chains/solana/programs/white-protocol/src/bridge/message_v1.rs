//! Bridge Message V1 — Canonical encoding and hashing for The White Protocol private bridge.
//!
//! Cross-language parity: TypeScript, Solidity, and Rust must all produce
//! identical keccak256 hashes for the same message inputs.
//!
//! Copied from white-bridge-solana/src/bridge_message_v1.rs and adapted
//! to use WhiteProtocolError.

use crate::error::WhiteProtocolError;
use anchor_lang::prelude::*;
use sha3::{Digest, Keccak256};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Exact ASCII domain separator — consensus-critical
pub const BRIDGE_MESSAGE_DOMAIN_SEPARATOR: &[u8] = b"WHITE_PRIVATE_BRIDGE_MESSAGE_V1";

/// Fixed encoded message length in bytes
pub const BRIDGE_MESSAGE_ENCODED_LENGTH: usize = 451;

pub const PROTOCOL_VERSION: u16 = 1;
pub const MESSAGE_TYPE_BRIDGE_OUT: u8 = 1;
pub const MESSAGE_TYPE_BRIDGE_MINT: u8 = 2;

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, AnchorSerialize, AnchorDeserialize)]
pub struct BridgeMessageV1 {
    pub protocol_version: u16,
    pub message_type: u8,
    pub source_domain: u32,
    pub destination_domain: u32,
    pub source_chain_id: u64,
    pub destination_chain_id: u64,
    pub canonical_asset_id: [u8; 32],
    pub source_local_asset_id: [u8; 32],
    pub destination_local_asset_id: [u8; 32],
    pub amount: u128,
    pub source_nullifier_hash: [u8; 32],
    pub destination_commitment: [u8; 32],
    pub source_root: [u8; 32],
    pub source_leaf_index: u64,
    pub source_tx_hash: [u8; 32],
    pub source_block_number: u64,
    pub source_finality_block: u64,
    pub nonce: u64,
    pub deadline: u64,
    pub relayer_fee: u128,
    pub recipient_stealth_metadata_hash: [u8; 32],
    pub memo_hash: [u8; 32],
    pub reserved0: [u8; 32],
    pub reserved1: [u8; 32],
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/// Encode a BridgeMessageV1 into a fixed-length Vec<u8> (451 bytes).
/// Returns error on validation failure.
pub fn encode_bridge_message_v1(msg: &BridgeMessageV1) -> Result<Vec<u8>> {
    validate_bridge_message_v1(msg)?;

    let mut out = Vec::with_capacity(BRIDGE_MESSAGE_ENCODED_LENGTH);

    out.extend_from_slice(&msg.protocol_version.to_be_bytes());
    out.push(msg.message_type);
    out.extend_from_slice(&msg.source_domain.to_be_bytes());
    out.extend_from_slice(&msg.destination_domain.to_be_bytes());
    out.extend_from_slice(&msg.source_chain_id.to_be_bytes());
    out.extend_from_slice(&msg.destination_chain_id.to_be_bytes());
    out.extend_from_slice(&msg.canonical_asset_id);
    out.extend_from_slice(&msg.source_local_asset_id);
    out.extend_from_slice(&msg.destination_local_asset_id);
    out.extend_from_slice(&msg.amount.to_be_bytes());
    out.extend_from_slice(&msg.source_nullifier_hash);
    out.extend_from_slice(&msg.destination_commitment);
    out.extend_from_slice(&msg.source_root);
    out.extend_from_slice(&msg.source_leaf_index.to_be_bytes());
    out.extend_from_slice(&msg.source_tx_hash);
    out.extend_from_slice(&msg.source_block_number.to_be_bytes());
    out.extend_from_slice(&msg.source_finality_block.to_be_bytes());
    out.extend_from_slice(&msg.nonce.to_be_bytes());
    out.extend_from_slice(&msg.deadline.to_be_bytes());
    out.extend_from_slice(&msg.relayer_fee.to_be_bytes());
    out.extend_from_slice(&msg.recipient_stealth_metadata_hash);
    out.extend_from_slice(&msg.memo_hash);
    out.extend_from_slice(&msg.reserved0);
    out.extend_from_slice(&msg.reserved1);

    if out.len() != BRIDGE_MESSAGE_ENCODED_LENGTH {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    Ok(out)
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/// Compute keccak256 hash
fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    let out = hasher.finalize();
    let mut h = [0u8; 32];
    h.copy_from_slice(&out);
    h
}

/// Compute the canonical keccak256 hash of a BridgeMessageV1.
/// Hash = keccak256(domainSeparator || encodedMessage)
pub fn hash_bridge_message_v1(msg: &BridgeMessageV1) -> Result<[u8; 32]> {
    let encoded = encode_bridge_message_v1(msg)?;
    let mut combined = Vec::with_capacity(BRIDGE_MESSAGE_DOMAIN_SEPARATOR.len() + encoded.len());
    combined.extend_from_slice(BRIDGE_MESSAGE_DOMAIN_SEPARATOR);
    combined.extend_from_slice(&encoded);
    Ok(keccak256(&combined))
}

/// Hash an already-encoded message buffer.
pub fn hash_encoded_bridge_message_v1(encoded: &[u8]) -> Result<[u8; 32]> {
    if encoded.len() != BRIDGE_MESSAGE_ENCODED_LENGTH {
        return Err(WhiteProtocolError::InvalidInput.into());
    }
    let mut combined = Vec::with_capacity(BRIDGE_MESSAGE_DOMAIN_SEPARATOR.len() + encoded.len());
    combined.extend_from_slice(BRIDGE_MESSAGE_DOMAIN_SEPARATOR);
    combined.extend_from_slice(encoded);
    Ok(keccak256(&combined))
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/// Validate a BridgeMessageV1. Returns Ok(()) if valid, else an Anchor error.
pub fn validate_bridge_message_v1(msg: &BridgeMessageV1) -> Result<()> {
    if msg.protocol_version != PROTOCOL_VERSION {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    if msg.message_type != MESSAGE_TYPE_BRIDGE_OUT && msg.message_type != MESSAGE_TYPE_BRIDGE_MINT {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    if msg.source_domain == 0 {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    if msg.destination_domain == 0 {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    if msg.source_domain == msg.destination_domain {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    if msg.amount == 0 {
        return Err(WhiteProtocolError::InvalidAmount.into());
    }

    if msg.deadline == 0 {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    if msg.canonical_asset_id == [0u8; 32] {
        return Err(WhiteProtocolError::InvalidAssetId.into());
    }

    if msg.message_type == MESSAGE_TYPE_BRIDGE_OUT && msg.destination_commitment == [0u8; 32] {
        return Err(WhiteProtocolError::InvalidCommitment.into());
    }

    if msg.message_type == MESSAGE_TYPE_BRIDGE_OUT && msg.source_nullifier_hash == [0u8; 32] {
        return Err(WhiteProtocolError::InvalidNullifier.into());
    }

    if msg.source_finality_block < msg.source_block_number {
        return Err(WhiteProtocolError::InvalidInput.into());
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_valid_message() -> BridgeMessageV1 {
        BridgeMessageV1 {
            protocol_version: 1,
            message_type: MESSAGE_TYPE_BRIDGE_OUT,
            source_domain: 33554434,
            destination_domain: 33554435,
            source_chain_id: 84532,
            destination_chain_id: 11155111,
            canonical_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            source_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            destination_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            amount: 1_000_000_000_000_000_000u128,
            source_nullifier_hash: hex_to_bytes32(
                "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            ),
            destination_commitment: hex_to_bytes32(
                "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
            ),
            source_root: hex_to_bytes32(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
            source_leaf_index: 7,
            source_tx_hash: hex_to_bytes32(
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            source_block_number: 12345678,
            source_finality_block: 12345688,
            nonce: 1,
            deadline: 1770000000,
            relayer_fee: 5_000_000_000_000_000u128,
            recipient_stealth_metadata_hash: [0u8; 32],
            memo_hash: [0u8; 32],
            reserved0: [0u8; 32],
            reserved1: [0u8; 32],
        }
    }

    fn hex_to_bytes32(hex: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        let bytes = hex::decode(hex).unwrap();
        out.copy_from_slice(&bytes);
        out
    }

    #[test]
    fn test_encode_length() {
        let msg = make_valid_message();
        let encoded = encode_bridge_message_v1(&msg).unwrap();
        assert_eq!(encoded.len(), BRIDGE_MESSAGE_ENCODED_LENGTH);
    }

    #[test]
    fn test_hash_deterministic() {
        let msg = make_valid_message();
        let h1 = hash_bridge_message_v1(&msg).unwrap();
        let h2 = hash_bridge_message_v1(&msg).unwrap();
        assert_eq!(h1, h2);
    }

    #[test]
    fn test_hash_non_zero() {
        let msg = make_valid_message();
        let h = hash_bridge_message_v1(&msg).unwrap();
        assert_ne!(h, [0u8; 32]);
    }

    #[test]
    fn test_hash_encoded_matches() {
        let msg = make_valid_message();
        let encoded = encode_bridge_message_v1(&msg).unwrap();
        let h1 = hash_bridge_message_v1(&msg).unwrap();
        let h2 = hash_encoded_bridge_message_v1(&encoded).unwrap();
        assert_eq!(h1, h2);
    }

    // Golden vector 1: Base Sepolia -> Ethereum Sepolia BridgeOut
    #[test]
    fn test_vector1_base_to_eth_bridge_out() {
        let msg = BridgeMessageV1 {
            protocol_version: 1,
            message_type: MESSAGE_TYPE_BRIDGE_OUT,
            source_domain: 33554434,
            destination_domain: 33554435,
            source_chain_id: 84532,
            destination_chain_id: 11155111,
            canonical_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            source_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            destination_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            amount: 1_000_000_000_000_000_000u128,
            source_nullifier_hash: hex_to_bytes32(
                "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
            ),
            destination_commitment: hex_to_bytes32(
                "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
            ),
            source_root: hex_to_bytes32(
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ),
            source_leaf_index: 7,
            source_tx_hash: hex_to_bytes32(
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            ),
            source_block_number: 12345678,
            source_finality_block: 12345688,
            nonce: 1,
            deadline: 1770000000,
            relayer_fee: 5_000_000_000_000_000u128,
            recipient_stealth_metadata_hash: [0u8; 32],
            memo_hash: [0u8; 32],
            reserved0: [0u8; 32],
            reserved1: [0u8; 32],
        };
        let encoded = encode_bridge_message_v1(&msg).unwrap();
        assert_eq!(encoded.len(), BRIDGE_MESSAGE_ENCODED_LENGTH);
        let hash = hash_bridge_message_v1(&msg).unwrap();
        assert_eq!(
            hash,
            hex_to_bytes32("b4ac9c8ca75af8eb1ff0b31acf18657abffbbc3322a410194eb7815e4b8da464")
        );
    }

    // Golden vector 2: BNB Testnet -> Polygon Amoy BridgeOut
    #[test]
    fn test_vector2_bnb_to_polygon_bridge_out() {
        let msg = BridgeMessageV1 {
            protocol_version: 1,
            message_type: MESSAGE_TYPE_BRIDGE_OUT,
            source_domain: 33554438,
            destination_domain: 33554436,
            source_chain_id: 97,
            destination_chain_id: 80002,
            canonical_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 2;
                b
            },
            source_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 2;
                b
            },
            destination_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 2;
                b
            },
            amount: 123456789u128,
            source_nullifier_hash: hex_to_bytes32(
                "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            ),
            destination_commitment: hex_to_bytes32(
                "cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe",
            ),
            source_root: hex_to_bytes32(
                "1111111111111111111111111111111111111111111111111111111111111111",
            ),
            source_leaf_index: 42,
            source_tx_hash: hex_to_bytes32(
                "2222222222222222222222222222222222222222222222222222222222222222",
            ),
            source_block_number: 98765432,
            source_finality_block: 98765447,
            nonce: 99,
            deadline: 1775000000,
            relayer_fee: 1_000_000u128,
            recipient_stealth_metadata_hash: [0u8; 32],
            memo_hash: [0u8; 32],
            reserved0: [0u8; 32],
            reserved1: [0u8; 32],
        };
        let encoded = encode_bridge_message_v1(&msg).unwrap();
        assert_eq!(encoded.len(), BRIDGE_MESSAGE_ENCODED_LENGTH);
        let hash = hash_bridge_message_v1(&msg).unwrap();
        assert_eq!(
            hash,
            hex_to_bytes32("ddb2b950bbab4f2593fc988f4a477eeb36d57f4a71508f55febb31acbf58d7f4")
        );
    }

    // Golden vector 3: Solana Devnet -> Base Sepolia BridgeOut
    #[test]
    fn test_vector3_solana_to_base_bridge_out() {
        let msg = BridgeMessageV1 {
            protocol_version: 1,
            message_type: MESSAGE_TYPE_BRIDGE_OUT,
            source_domain: 33554433,
            destination_domain: 33554434,
            source_chain_id: 0,
            destination_chain_id: 84532,
            canonical_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            source_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            destination_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 1;
                b
            },
            amount: 500_000_000_000_000_000u128,
            source_nullifier_hash: hex_to_bytes32(
                "abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            ),
            destination_commitment: hex_to_bytes32(
                "5555555555555555555555555555555555555555555555555555555555555555",
            ),
            source_root: hex_to_bytes32(
                "6666666666666666666666666666666666666666666666666666666666666666",
            ),
            source_leaf_index: 0,
            source_tx_hash: hex_to_bytes32(
                "7777777777777777777777777777777777777777777777777777777777777777",
            ),
            source_block_number: 150000000,
            source_finality_block: 150000032,
            nonce: 3,
            deadline: 1780000000,
            relayer_fee: 2_500_000_000_000_000u128,
            recipient_stealth_metadata_hash: hex_to_bytes32(
                "8888888888888888888888888888888888888888888888888888888888888888",
            ),
            memo_hash: hex_to_bytes32(
                "9999999999999999999999999999999999999999999999999999999999999999",
            ),
            reserved0: [0u8; 32],
            reserved1: [0u8; 32],
        };
        let encoded = encode_bridge_message_v1(&msg).unwrap();
        assert_eq!(encoded.len(), BRIDGE_MESSAGE_ENCODED_LENGTH);
        let hash = hash_bridge_message_v1(&msg).unwrap();
        assert_eq!(
            hash,
            hex_to_bytes32("8c0c22e9417df1a7c3a570afde1679472a406d67f8cf4a043cd445ce67eed344")
        );
    }

    // Golden vector 4: Ethereum Sepolia -> Base Sepolia BridgeMint
    #[test]
    fn test_vector4_eth_to_base_bridge_mint() {
        let msg = BridgeMessageV1 {
            protocol_version: 1,
            message_type: MESSAGE_TYPE_BRIDGE_MINT,
            source_domain: 33554435,
            destination_domain: 33554434,
            source_chain_id: 11155111,
            destination_chain_id: 84532,
            canonical_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 3;
                b
            },
            source_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 3;
                b
            },
            destination_local_asset_id: {
                let mut b = [0u8; 32];
                b[31] = 3;
                b
            },
            amount: 10_000_000_000_000_000_000u128,
            source_nullifier_hash: hex_to_bytes32(
                "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
            ),
            destination_commitment: hex_to_bytes32(
                "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
            ),
            source_root: hex_to_bytes32(
                "404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f",
            ),
            source_leaf_index: 100,
            source_tx_hash: hex_to_bytes32(
                "606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f",
            ),
            source_block_number: 5555555,
            source_finality_block: 5555567,
            nonce: 42,
            deadline: 1785000000,
            relayer_fee: 10_000_000_000_000_000u128,
            recipient_stealth_metadata_hash: [0u8; 32],
            memo_hash: [0u8; 32],
            reserved0: [0u8; 32],
            reserved1: [0u8; 32],
        };
        let encoded = encode_bridge_message_v1(&msg).unwrap();
        assert_eq!(encoded.len(), BRIDGE_MESSAGE_ENCODED_LENGTH);
        let hash = hash_bridge_message_v1(&msg).unwrap();
        assert_eq!(
            hash,
            hex_to_bytes32("bfc85db07abe8b9e72838726899619013a18e2580f3d1ee3e688323a41e406e7")
        );
    }
}
