//! Stealth address utilities for The White Protocol (Solana / ed25519).
//!
//! Mirrors the TypeScript implementation in `packages/core/src/stealth`
//! so that test vectors are identical across both implementations.

use curve25519_dalek::constants::ED25519_BASEPOINT_POINT;
use curve25519_dalek::edwards::CompressedEdwardsY;
use curve25519_dalek::scalar::Scalar;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};

pub const SALT: &[u8] = b"whiteprotocol-stealth-v1";
pub const HKDF_INFO_META: &[u8] = b"meta";
pub const HKDF_INFO_SPEND: &[u8] = b"spend-ed25519";
pub const HKDF_INFO_VIEW: &[u8] = b"view-ed25519";

/// Derive a deterministic 32-byte seed from an IKM using HKDF-SHA256.
pub fn derive_stealth_seed(ikm: &[u8]) -> [u8; 32] {
    let hk = Hkdf::<Sha256>::new(Some(SALT), ikm);
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO_META, &mut okm)
        .expect("32-byte expand is valid");
    okm
}

/// Reduce 32 bytes to an ed25519 scalar modulo ℓ.
/// Uses big-endian interpretation to match the TypeScript implementation.
fn bytes_to_scalar(bytes: &[u8; 32]) -> Scalar {
    let mut be = *bytes;
    be.reverse(); // curve25519-dalek uses little-endian; we need big-endian
    Scalar::from_bytes_mod_order(be)
}

/// Convert a scalar to 32 big-endian bytes.
fn scalar_to_bytes(scalar: &Scalar) -> [u8; 32] {
    let mut le = scalar.to_bytes();
    le.reverse();
    le
}

/// Derive a scalar from a seed using HKDF-expand.
fn hkdf_scalar(seed: &[u8; 32], info: &[u8]) -> Scalar {
    let hk = Hkdf::<Sha256>::new(None, seed);
    let mut okm = [0u8; 32];
    hk.expand(info, &mut okm)
        .expect("32-byte expand is valid");
    bytes_to_scalar(&okm)
}

/// A meta-address for Solana (ed25519).
#[derive(Debug, Clone, PartialEq)]
pub struct MetaAddress {
    pub spend_pub: [u8; 32],
    pub view_pub: [u8; 32],
}

/// A generated stealth address result.
#[derive(Debug, Clone, PartialEq)]
pub struct StealthAddress {
    pub address: [u8; 32],
    pub ephemeral_pubkey: [u8; 32],
    pub ephemeral_private_key: [u8; 32],
}

/// Generate a Solana meta-address from a seed.
pub fn generate_solana_meta_address_from_seed(seed: &[u8; 32]) -> (MetaAddress, [u8; 32], [u8; 32]) {
    let spend_scalar = hkdf_scalar(seed, HKDF_INFO_SPEND);
    let view_scalar = hkdf_scalar(seed, HKDF_INFO_VIEW);

    let spend_pub = (spend_scalar * ED25519_BASEPOINT_POINT).compress().to_bytes();
    let view_pub = (view_scalar * ED25519_BASEPOINT_POINT).compress().to_bytes();

    (
        MetaAddress { spend_pub, view_pub },
        scalar_to_bytes(&spend_scalar),
        scalar_to_bytes(&view_scalar),
    )
}

/// Sender-side: derive a stealth address for a recipient.
pub fn derive_stealth_address(
    meta: &MetaAddress,
    ephemeral_priv: Option<&[u8; 32]>,
) -> StealthAddress {
    let r_bytes = ephemeral_priv.copied().unwrap_or_else(|| {
        let mut buf = [0u8; 32];
        // Use a simple deterministic RNG for testing; production should use OsRng
        getrandom::getrandom(&mut buf).expect("CSPRNG failure");
        buf
    });
    let r_scalar = bytes_to_scalar(&r_bytes);
    let r_point = r_scalar * ED25519_BASEPOINT_POINT;
    let ephemeral_pubkey = r_point.compress().to_bytes();

    let view_point = CompressedEdwardsY(meta.view_pub)
        .decompress()
        .expect("Invalid view pubkey");
    let shared_point = r_scalar * view_point;
    let hash = Sha256::digest(shared_point.compress().as_bytes());
    let s = Scalar::from_bytes_mod_order(hash.into());

    let spend_point = CompressedEdwardsY(meta.spend_pub)
        .decompress()
        .expect("Invalid spend pubkey");
    let stealth_point = spend_point + s * ED25519_BASEPOINT_POINT;
    let address = stealth_point.compress().to_bytes();

    StealthAddress {
        address,
        ephemeral_pubkey,
        ephemeral_private_key: r_bytes,
    }
}

/// Recipient-side: attempt to detect a stealth payment.
pub fn try_decrypt_stealth_payment(
    ephemeral_pubkey: &[u8; 32],
    destination: &[u8; 32],
    view_priv: &[u8; 32],
    spend_pub: &[u8; 32],
) -> Option<[u8; 32]> {
    let view_scalar = bytes_to_scalar(view_priv);
    let r_point = CompressedEdwardsY(*ephemeral_pubkey)
        .decompress()?;
    let shared_point = view_scalar * r_point;
    let hash = Sha256::digest(shared_point.compress().as_bytes());
    let s = Scalar::from_bytes_mod_order(hash.into());

    let spend_point = CompressedEdwardsY(*spend_pub)
        .decompress()?;
    let expected = spend_point + s * ED25519_BASEPOINT_POINT;
    let expected_bytes = expected.compress().to_bytes();

    if constant_time_eq(&expected_bytes, destination) {
        Some(scalar_to_bytes(&s))
    } else {
        None
    }
}

/// Derive the stealth private key from the spend private key and shared secret.
pub fn compute_stealth_private_key(spend_priv: &[u8; 32], s: &[u8; 32]) -> [u8; 32] {
    let spend_scalar = bytes_to_scalar(spend_priv);
    let s_scalar = bytes_to_scalar(s);
    scalar_to_bytes(&(spend_scalar + s_scalar))
}

/// Derive the stealth public key from the stealth private key.
pub fn stealth_pubkey_from_private_key(stealth_priv: &[u8; 32]) -> [u8; 32] {
    let scalar = bytes_to_scalar(stealth_priv);
    (scalar * ED25519_BASEPOINT_POINT).compress().to_bytes()
}

fn constant_time_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for i in 0..32 {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Serialize a meta-address to base58.
/// Format: base58(0x01 || spend_pub || view_pub || checksum4)
pub fn serialize_meta_address(meta: &MetaAddress) -> String {
    let mut payload = Vec::with_capacity(1 + 32 + 32 + 4);
    payload.push(0x01);
    payload.extend_from_slice(&meta.spend_pub);
    payload.extend_from_slice(&meta.view_pub);
    let hash = Sha256::digest(&payload);
    payload.extend_from_slice(&hash[..4]);
    bs58::encode(payload).into_string()
}

/// Parse a base58 meta-address string.
pub fn parse_meta_address(serialized: &str) -> Result<MetaAddress, StealthError> {
    let payload = bs58::decode(serialized)
        .into_vec()
        .map_err(|_| StealthError::InvalidEncoding)?;
    if payload.len() != 1 + 32 + 32 + 4 {
        return Err(StealthError::InvalidLength);
    }
    if payload[0] != 0x01 {
        return Err(StealthError::InvalidChainTag);
    }
    let data = &payload[..1 + 32 + 32];
    let checksum = &payload[1 + 32 + 32..];
    let hash = Sha256::digest(data);
    let mut computed_checksum = [0u8; 4];
    computed_checksum.copy_from_slice(&hash[..4]);
    if checksum != &computed_checksum {
        return Err(StealthError::InvalidChecksum);
    }
    let mut spend_pub = [0u8; 32];
    let mut view_pub = [0u8; 32];
    spend_pub.copy_from_slice(&data[1..33]);
    view_pub.copy_from_slice(&data[33..65]);
    Ok(MetaAddress { spend_pub, view_pub })
}

#[derive(Debug, thiserror::Error)]
pub enum StealthError {
    #[error("Invalid base58 encoding")]
    InvalidEncoding,
    #[error("Invalid meta-address length")]
    InvalidLength,
    #[error("Invalid chain tag")]
    InvalidChainTag,
    #[error("Invalid checksum")]
    InvalidChecksum,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex_to_bytes32(hex: &str) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        hex::decode_to_slice(hex, &mut bytes).unwrap();
        bytes
    }

    #[test]
    fn test_round_trip() {
        let seed = derive_stealth_seed(&[1u8; 32]);
        let (meta, spend_priv, view_priv) = generate_solana_meta_address_from_seed(&seed);

        let stealth = derive_stealth_address(&meta, None);

        let s = try_decrypt_stealth_payment(
            &stealth.ephemeral_pubkey,
            &stealth.address,
            &view_priv,
            &meta.spend_pub,
        )
        .expect("Should detect payment");

        let stealth_priv = compute_stealth_private_key(&spend_priv, &s);
        let derived_pub = stealth_pubkey_from_private_key(&stealth_priv);
        assert_eq!(derived_pub, stealth.address);
    }

    #[test]
    fn test_wrong_view_key_fails() {
        let seed = derive_stealth_seed(&[1u8; 32]);
        let (meta, _spend_priv, view_priv) = generate_solana_meta_address_from_seed(&seed);
        let stealth = derive_stealth_address(&meta, None);

        let wrong_seed = derive_stealth_seed(&[2u8; 32]);
        let (_wrong_meta, _wrong_spend, wrong_view) = generate_solana_meta_address_from_seed(&wrong_seed);

        let result = try_decrypt_stealth_payment(
            &stealth.ephemeral_pubkey,
            &stealth.address,
            &wrong_view,
            &meta.spend_pub,
        );
        assert!(result.is_none());
    }

    // Test vectors matching TypeScript implementation
    #[test]
    fn test_vector_1() {
        let seed = hex_to_bytes32("0000000000000000000000000000000000000000000000000000000000000001");
        let (meta, _spend_priv, _view_priv) = generate_solana_meta_address_from_seed(&seed);
        assert_eq!(
            hex::encode(&meta.spend_pub[..2]),
            "660e"
        );
        assert_eq!(
            hex::encode(&meta.view_pub[..2]),
            "ae59"
        );
    }

    #[test]
    fn test_vector_2() {
        let seed = hex_to_bytes32("0000000000000000000000000000000000000000000000000000000000000002");
        let (meta, _spend_priv, _view_priv) = generate_solana_meta_address_from_seed(&seed);
        assert_eq!(
            hex::encode(&meta.spend_pub[..2]),
            "34c3"
        );
        assert_eq!(
            hex::encode(&meta.view_pub[..2]),
            "9e33"
        );
    }

    #[test]
    fn test_vector_3() {
        let seed = hex_to_bytes32("abababababababababababababababababababababababababababababababab");
        let (meta, _spend_priv, _view_priv) = generate_solana_meta_address_from_seed(&seed);
        assert_eq!(
            hex::encode(&meta.spend_pub[..2]),
            "140c"
        );
        assert_eq!(
            hex::encode(&meta.view_pub[..2]),
            "fe65"
        );
    }

    #[test]
    fn test_vector_4() {
        let seed = hex_to_bytes32("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        let (meta, _spend_priv, _view_priv) = generate_solana_meta_address_from_seed(&seed);
        assert_eq!(
            hex::encode(&meta.spend_pub[..2]),
            "5fe2"
        );
        assert_eq!(
            hex::encode(&meta.view_pub[..2]),
            "8506"
        );
    }

    #[test]
    fn test_vector_5() {
        let seed = hex_to_bytes32("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
        let (meta, _spend_priv, _view_priv) = generate_solana_meta_address_from_seed(&seed);
        assert_eq!(
            hex::encode(&meta.spend_pub[..2]),
            "71e7"
        );
        assert_eq!(
            hex::encode(&meta.view_pub[..2]),
            "67fe"
        );
    }
}

#[cfg(test)]
mod debug_tests {
    use super::*;

    #[test]
    fn hkdf_debug() {
        let ikm = [1u8; 32];
        let seed = derive_stealth_seed(&ikm);
        println!("Rust seed: {}", hex::encode(seed));

        let hk = Hkdf::<Sha256>::new(None, &seed);
        let mut okm = [0u8; 32];
        hk.expand(HKDF_INFO_SPEND, &mut okm).unwrap();
        println!("Rust spend raw: {}", hex::encode(okm));
    }
}

#[cfg(test)]
mod debug_tests2 {
    use super::*;

    #[test]
    fn scalar_debug() {
        let ikm = [1u8; 32];
        let seed = derive_stealth_seed(&ikm);
        let hk = Hkdf::<Sha256>::new(None, &seed);
        let mut okm = [0u8; 32];
        hk.expand(HKDF_INFO_SPEND, &mut okm).unwrap();
        println!("Rust spend raw: {}", hex::encode(okm));
        
        let scalar = bytes_to_scalar(&okm);
        println!("Rust spend scalar bytes: {}", hex::encode(scalar.to_bytes()));
        
        let pub_key = (scalar * ED25519_BASEPOINT_POINT).compress().to_bytes();
        println!("Rust spend pub: {}", hex::encode(pub_key));
    }
}
