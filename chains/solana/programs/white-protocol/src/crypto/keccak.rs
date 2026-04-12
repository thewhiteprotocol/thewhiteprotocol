use anchor_lang::prelude::*;
use sha3::{Digest, Keccak256};

/// Compute keccak256 hash of data
pub fn keccak256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    hasher.update(data);
    let out = hasher.finalize();
    let mut h = [0u8; 32];
    h.copy_from_slice(&out);
    h
}

/// Compute keccak256 hash of multiple inputs (concatenated)
pub fn keccak256_concat(inputs: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Keccak256::new();
    for chunk in inputs {
        hasher.update(chunk);
    }
    let out = hasher.finalize();
    let mut h = [0u8; 32];
    h.copy_from_slice(&out);
    h
}

/// Derive asset ID from mint address (raw keccak; if you need canonical Fr, do that at call site)
/// Derive asset ID from mint address (canonical BN254 Fr element)
pub fn derive_asset_id(mint: &Pubkey) -> [u8; 32] {
    let h = keccak256_concat(&[b"white:asset_id:v1", mint.as_ref()]);
    let mut out = [0u8; 32];
    out[1..32].copy_from_slice(&h[0..31]);
    out
}

/// Derive asset ID as u32 (for external systems if needed)
pub fn derive_asset_id_u32(mint: &Pubkey) -> u32 {
    let h = keccak256(mint.as_ref());
    u32::from_le_bytes([h[0], h[1], h[2], h[3]])
}

/// Compute verification key hash
pub fn hash_verification_key(vk_data: &[u8]) -> [u8; 32] {
    keccak256(vk_data)
}

/// Compute commitment hash (deterministic identifier)
pub fn hash_commitment(commitment: &[u8; 32]) -> [u8; 32] {
    keccak256(commitment)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keccak256_deterministic() {
        let data = b"hello world";
        assert_eq!(keccak256(data), keccak256(data));
    }

    #[test]
    fn test_keccak256_different_inputs() {
        assert_ne!(keccak256(b"hello"), keccak256(b"world"));
    }

    #[test]
    fn test_keccak256_concat_matches_manual_concat() {
        let a = b"hello";
        let b = b"world";

        let h1 = keccak256_concat(&[a, b]);

        let mut combined = Vec::new();
        combined.extend_from_slice(a);
        combined.extend_from_slice(b);
        let h2 = keccak256(&combined);

        assert_eq!(h1, h2);
    }

    #[test]
    fn test_derive_asset_id_deterministic() {
        let mint = Pubkey::new_unique();
        assert_eq!(derive_asset_id(&mint), derive_asset_id(&mint));
    }

    #[test]
    fn test_derive_asset_id_different_mints() {
        let mint1 = Pubkey::new_unique();
        let mint2 = Pubkey::new_unique();
        assert_ne!(derive_asset_id(&mint1), derive_asset_id(&mint2));
    }

    #[test]
    fn test_keccak256_known_vector_empty() {
        let hash = keccak256(b"");
        let expected = [
            0xc5, 0xd2, 0x46, 0x01, 0x86, 0xf7, 0x23, 0x3c, 0x92, 0x7e, 0x7d, 0xb2, 0xdc, 0xc7,
            0x03, 0xc0, 0xe5, 0x00, 0xb6, 0x53, 0xca, 0x82, 0x27, 0x3b, 0x7b, 0xfa, 0xd8, 0x04,
            0x5d, 0x85, 0xa4, 0x70,
        ];
        assert_eq!(hash, expected);
    }
}
