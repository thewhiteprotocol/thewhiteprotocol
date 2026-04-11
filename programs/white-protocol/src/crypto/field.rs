//! BN254 Field Element Validation
//!
//! Provides strict canonical validation for scalar field (Fr) and base field (Fp) elements.
//! All elements must be < modulus; equal-to-modulus or greater are rejected.
//!
//! # Encoding
//! All field elements are 32 bytes, BIG-ENDIAN (most significant byte first).
//! This matches circomlib, snarkjs, and Solana syscall conventions.

use crate::error::WhiteProtocolError;
use anchor_lang::prelude::*;

/// BN254 base field modulus (Fp) - for point coordinates
/// p = 21888242871839275222246405745257275088696311157297823662689037894645226208583
/// Hex: 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47
pub const BN254_FP_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d, 0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
];

/// BN254 scalar field modulus (Fr) - for scalars/exponents and Poseidon
/// r = 21888242871839275222246405745257275088548364400416034343698204186575808495617
/// Hex: 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001
pub const BN254_FR_MODULUS: [u8; 32] = [
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29, 0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91, 0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x01,
];

/// Check if big-endian bytes represent a value strictly less than the given modulus.
/// Returns true if value < modulus (canonical), false otherwise.
#[inline]
fn is_less_than(value: &[u8; 32], modulus: &[u8; 32]) -> bool {
    for i in 0..32 {
        if value[i] < modulus[i] {
            return true;
        }
        if value[i] > modulus[i] {
            return false;
        }
    }
    false // Equal to modulus is NOT valid
}

/// Check if a 32-byte value is a canonical Fr element (< Fr modulus).
#[inline]
pub fn is_valid_fr(value: &[u8; 32]) -> bool {
    is_less_than(value, &BN254_FR_MODULUS)
}

/// Check if a 32-byte value is a canonical Fp element (< Fp modulus).
#[inline]
pub fn is_valid_fp(value: &[u8; 32]) -> bool {
    is_less_than(value, &BN254_FP_MODULUS)
}

/// Validate Fr element, returning error if non-canonical.
#[inline]
pub fn validate_fr(value: &[u8; 32]) -> Result<()> {
    if !is_valid_fr(value) {
        return Err(WhiteProtocolError::InvalidPublicInputs.into());
    }
    Ok(())
}

/// Validate Fp element, returning error if non-canonical.
#[inline]
pub fn validate_fp(value: &[u8; 32]) -> Result<()> {
    if !is_valid_fp(value) {
        return Err(WhiteProtocolError::CryptographyError.into());
    }
    Ok(())
}

/// Check if 32-byte value is all zeros.
#[inline]
pub fn is_zero(value: &[u8; 32]) -> bool {
    value.iter().all(|&b| b == 0)
}

/// Check if 64-byte G1 point is the identity (all zeros).
#[inline]
pub fn is_g1_identity(point: &[u8; 64]) -> bool {
    point.iter().all(|&b| b == 0)
}

/// Subtract two 32-byte big-endian numbers: result = a - b
/// Assumes a >= b (no underflow check - caller must ensure this).
pub fn be_subtract(a: &[u8; 32], b: &[u8; 32]) -> [u8; 32] {
    let mut result = [0u8; 32];
    let mut borrow: u16 = 0;

    for i in (0..32).rev() {
        let diff = (a[i] as u16).wrapping_sub(b[i] as u16).wrapping_sub(borrow);
        result[i] = diff as u8;
        borrow = if diff > 255 { 1 } else { 0 };
    }

    result
}

/// Convert u64 to 32-byte big-endian scalar.
/// Result is always canonical (u64::MAX < Fr modulus).
#[inline]
pub fn u64_to_be32(value: u64) -> [u8; 32] {
    let mut result = [0u8; 32];
    result[24..32].copy_from_slice(&value.to_be_bytes());
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_fr_modulus_bytes() {
        // First 4 bytes should be 0x30644e72
        assert_eq!(BN254_FR_MODULUS[0], 0x30);
        assert_eq!(BN254_FR_MODULUS[1], 0x64);
        assert_eq!(BN254_FR_MODULUS[2], 0x4e);
        assert_eq!(BN254_FR_MODULUS[3], 0x72);
        // Last byte is 0x01
        assert_eq!(BN254_FR_MODULUS[31], 0x01);
    }

    #[test]
    fn test_fp_modulus_bytes() {
        // First 4 bytes should be 0x30644e72
        assert_eq!(BN254_FP_MODULUS[0], 0x30);
        // Last byte is 0x47
        assert_eq!(BN254_FP_MODULUS[31], 0x47);
    }

    #[test]
    fn test_zero_is_valid() {
        assert!(is_valid_fr(&[0u8; 32]));
        assert!(is_valid_fp(&[0u8; 32]));
    }

    #[test]
    fn test_one_is_valid() {
        let mut one = [0u8; 32];
        one[31] = 1;
        assert!(is_valid_fr(&one));
        assert!(is_valid_fp(&one));
    }

    #[test]
    fn test_modulus_is_invalid() {
        assert!(!is_valid_fr(&BN254_FR_MODULUS));
        assert!(!is_valid_fp(&BN254_FP_MODULUS));
    }

    #[test]
    fn test_modulus_minus_one_is_valid() {
        let mut fr_max = BN254_FR_MODULUS;
        fr_max[31] = fr_max[31].wrapping_sub(1); // r - 1
        assert!(is_valid_fr(&fr_max));

        let mut fp_max = BN254_FP_MODULUS;
        fp_max[31] = fp_max[31].wrapping_sub(1); // p - 1
        assert!(is_valid_fp(&fp_max));
    }

    #[test]
    fn test_modulus_plus_one_is_invalid() {
        let mut above_fr = BN254_FR_MODULUS;
        above_fr[31] = above_fr[31].wrapping_add(1);
        assert!(!is_valid_fr(&above_fr));
    }

    #[test]
    fn test_u64_to_be32() {
        let scalar = u64_to_be32(0x0102030405060708);
        assert_eq!(
            &scalar[24..32],
            &[0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]
        );
        assert!(is_valid_fr(&scalar));
    }

    #[test]
    fn test_u64_max_is_valid_fr() {
        let max = u64_to_be32(u64::MAX);
        assert!(is_valid_fr(&max));
    }

    #[test]
    fn test_be_subtract() {
        let a = u64_to_be32(100);
        let b = u64_to_be32(42);
        let result = be_subtract(&a, &b);
        assert_eq!(result, u64_to_be32(58));
    }

    #[test]
    fn test_is_zero() {
        assert!(is_zero(&[0u8; 32]));
        let mut non_zero = [0u8; 32];
        non_zero[31] = 1;
        assert!(!is_zero(&non_zero));
    }

    #[test]
    fn test_validate_fr_returns_error() {
        let result = validate_fr(&BN254_FR_MODULUS);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_fp_returns_error() {
        let result = validate_fp(&BN254_FP_MODULUS);
        assert!(result.is_err());
    }
}
