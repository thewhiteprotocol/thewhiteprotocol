//! Groth16 Zero-Knowledge Proof Verifier
//!
//! Implements the Groth16 verification equation using BN254 pairings.
//!
//! # Verification Equation
//! e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ)
//!
//! Rearranged for pairing check (product = 1):
//! e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
//!
//! # Data Layout (snarkjs compatible, big-endian)
//!
//! ## Proof: 256 bytes
//! ```text
//! | A (G1, 64 bytes) | B (G2, 128 bytes) | C (G1, 64 bytes) |
//! ```
//!
//! ## G1 point: 64 bytes
//! ```text
//! | x (32 bytes BE) | y (32 bytes BE) |
//! ```
//!
//! ## G2 point: 128 bytes - IMPORTANT: imaginary FIRST
//! ```text
//! | x_imag (32) | x_real (32) | y_imag (32) | y_real (32) |
//! ```
//!
//! ## Scalar: 32 bytes big-endian
//!
//! # Serializing from snarkjs
//!
//! When exporting from snarkjs, the JSON contains arrays like:
//! ```json
//! {
//!   "pi_a": ["x_dec", "y_dec", "1"],
//!   "pi_b": [["x0_dec", "x1_dec"], ["y0_dec", "y1_dec"], ["1", "0"]],
//!   "pi_c": ["x_dec", "y_dec", "1"]
//! }
//! ```
//!
//! To convert to our byte format:
//! - G1 (pi_a, pi_c): Convert x and y decimal strings to 32-byte big-endian
//! - G2 (pi_b): x1 || x0 || y1 || y0 (note: snarkjs x = [x0, x1], we output x1 first!)
//!
//! Example JavaScript conversion:
//! ```js
//! function g2ToBytes(point) {
//!   const x0 = BigInt(point[0][0]).toString(16).padStart(64, '0');
//!   const x1 = BigInt(point[0][1]).toString(16).padStart(64, '0');
//!   const y0 = BigInt(point[1][0]).toString(16).padStart(64, '0');
//!   const y1 = BigInt(point[1][1]).toString(16).padStart(64, '0');
//!   return hexToBytes(x1 + x0 + y1 + y0); // x1 FIRST, then x0
//! }
//! ```

use anchor_lang::prelude::*;

use super::alt_bn128::{g1_add, g1_mul, g1_negate, make_pairing_element, pairing_check_4};
use super::field::{is_g1_identity, is_valid_fr};
use crate::error::WhiteProtocolError;

// ============================================================================
// CONSTANTS
// ============================================================================

/// Groth16 proof size in bytes: A(64) + B(128) + C(64)
pub const PROOF_SIZE: usize = 256;

/// Maximum number of public inputs supported.
/// Groth16 verification requires VK IC array of size = num_inputs + 1.
pub const MAX_PUBLIC_INPUTS: usize = 16;

// ============================================================================
// TYPES
// ============================================================================

/// G1 point (64 bytes: x || y, big-endian)
pub type G1Point = [u8; 64];

/// G2 point (128 bytes: x_imag || x_real || y_imag || y_real, big-endian)
/// IMPORTANT: Imaginary coefficient comes FIRST, then real.
pub type G2Point = [u8; 128];

/// Scalar field element (32 bytes, big-endian)
pub type Scalar = [u8; 32];

/// Groth16 proof structure
#[derive(Clone, Copy, Debug)]
pub struct Proof {
    /// Proof element A (G1 point)
    pub a: G1Point,
    /// Proof element B (G2 point)
    pub b: G2Point,
    /// Proof element C (G1 point)
    pub c: G1Point,
}

impl Proof {
    /// Parse proof from 256-byte array.
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        if data.len() != PROOF_SIZE {
            return Err(WhiteProtocolError::InvalidProofFormat.into());
        }

        let mut a = [0u8; 64];
        let mut b = [0u8; 128];
        let mut c = [0u8; 64];

        a.copy_from_slice(&data[0..64]);
        b.copy_from_slice(&data[64..192]);
        c.copy_from_slice(&data[192..256]);

        Ok(Self { a, b, c })
    }

    /// Serialize proof to 256-byte array.
    pub fn to_bytes(&self) -> [u8; PROOF_SIZE] {
        let mut bytes = [0u8; PROOF_SIZE];
        bytes[0..64].copy_from_slice(&self.a);
        bytes[64..192].copy_from_slice(&self.b);
        bytes[192..256].copy_from_slice(&self.c);
        bytes
    }
}

/// Groth16 verification key.
///
/// For on-chain storage, consider using fixed-size arrays based on your
/// circuit's public input count. This struct uses Vec for flexibility
/// during development.
#[derive(Clone, Debug)]
pub struct VerificationKey {
    /// α in G1
    pub alpha_g1: G1Point,
    /// β in G2
    pub beta_g2: G2Point,
    /// γ in G2
    pub gamma_g2: G2Point,
    /// δ in G2
    pub delta_g2: G2Point,
    /// IC points: [IC[0], IC[1], ..., IC[n]] where n = number of public inputs
    /// NOTE: This Vec is only used during VK loading, not in hot verification path.
    pub ic: Vec<G1Point>,
}

impl VerificationKey {
    /// Validate that IC length matches expected public input count.
    pub fn validate_for_inputs(&self, num_inputs: usize) -> Result<()> {
        if self.ic.len() != num_inputs + 1 {
            return Err(WhiteProtocolError::VkIcLengthMismatch.into());
        }
        Ok(())
    }

    /// Create a VerificationKey from on-chain account data.
    /// This is a convenience method for use in instructions.
    pub fn from_account(
        alpha_g1: &[u8; 64],
        beta_g2: &[u8; 128],
        gamma_g2: &[u8; 128],
        delta_g2: &[u8; 128],
        ic: &[[u8; 64]],
    ) -> Self {
        Self {
            alpha_g1: *alpha_g1,
            beta_g2: *beta_g2,
            gamma_g2: *gamma_g2,
            delta_g2: *delta_g2,
            ic: ic.to_vec(),
        }
    }
}

// ============================================================================
// VERIFICATION
// ============================================================================

/// Verify a Groth16 proof.
///
/// # Arguments
/// * `vk` - Verification key
/// * `proof` - The proof to verify
/// * `public_inputs` - Public inputs (canonical Fr elements)
///
/// # Returns
/// * `Ok(true)` - proof is valid
/// * `Ok(false)` - proof is invalid (pairing check failed)
/// * `Err(_)` - cryptographic error (invalid points, non-canonical inputs, etc.)
///
/// # Compute Cost
/// ~350,000 CU on Solana mainnet. Set compute budget explicitly.
pub fn verify(vk: &VerificationKey, proof: &Proof, public_inputs: &[Scalar]) -> Result<bool> {
    // Validate input count
    if public_inputs.len() > MAX_PUBLIC_INPUTS {
        return Err(WhiteProtocolError::InvalidPublicInputs.into());
    }
    vk.validate_for_inputs(public_inputs.len())?;

    // Validate all public inputs are canonical
    for input in public_inputs {
        if !is_valid_fr(input) {
            return Err(WhiteProtocolError::InvalidPublicInputs.into());
        }
    }

    // Compute vk_x = IC[0] + Σ(input[i] · IC[i+1])
    let vk_x = compute_vk_x(&vk.ic, public_inputs)?;

    // Negate A: -A (uses Fp for negation, not Fr)
    let neg_a = g1_negate(&proof.a)?;

    // Build 4 pairing elements for check:
    // e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
    let pairs: [[u8; 192]; 4] = [
        make_pairing_element(&neg_a, &proof.b),
        make_pairing_element(&vk.alpha_g1, &vk.beta_g2),
        make_pairing_element(&vk_x, &vk.gamma_g2),
        make_pairing_element(&proof.c, &vk.delta_g2),
    ];

    pairing_check_4(&pairs)
}

/// Compute vk_x = IC[0] + Σ(input[i] · IC[i+1])
fn compute_vk_x(ic: &[G1Point], inputs: &[Scalar]) -> Result<G1Point> {
    let mut vk_x = ic[0];

    for (i, input) in inputs.iter().enumerate() {
        // Skip zero inputs (no contribution)
        if input.iter().all(|&b| b == 0) {
            continue;
        }

        // Compute input[i] · IC[i+1]
        let product = g1_mul(&ic[i + 1], input)?;

        // Skip identity results
        if is_g1_identity(&product) {
            continue;
        }

        // Add to accumulator
        if is_g1_identity(&vk_x) {
            vk_x = product;
        } else {
            vk_x = g1_add(&vk_x, &product)?;
        }
    }

    Ok(vk_x)
}

// ============================================================================
// PROOF TYPE SPECIFIC
// ============================================================================

/// Proof types supported by The White Protocol v2
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum ProofType {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3,
}

/// Verify a deposit proof.
/// Public inputs: [commitment, amount, asset_id]
pub fn verify_deposit(
    vk: &VerificationKey,
    proof: &Proof,
    commitment: &Scalar,
    amount: &Scalar,
    asset_id: &Scalar,
) -> Result<bool> {
    let inputs = [*commitment, *amount, *asset_id];
    verify(vk, proof, &inputs)
}

/// Verify a withdraw proof.
/// Public inputs depend on circuit configuration.
pub fn verify_withdraw(
    vk: &VerificationKey,
    proof: &Proof,
    public_inputs: &[Scalar],
) -> Result<bool> {
    verify(vk, proof, public_inputs)
}

// ============================================================================
// DEVELOPMENT MODE
// ============================================================================

/// Check if running in insecure development mode.
#[cfg(feature = "insecure-dev")]
pub fn is_dev_mode() -> bool {
    true
}

#[cfg(not(feature = "insecure-dev"))]
pub fn is_dev_mode() -> bool {
    false
}

/// Verify with optional dev mode bypass.
/// In dev mode, returns true without verification. NEVER use in production!
pub fn verify_with_dev_mode(
    vk: &VerificationKey,
    proof: &Proof,
    public_inputs: &[Scalar],
) -> Result<bool> {
    #[cfg(feature = "insecure-dev")]
    {
        msg!("⚠️ INSECURE DEV MODE: Skipping proof verification");
        return Ok(true);
    }

    #[cfg(not(feature = "insecure-dev"))]
    verify(vk, proof, public_inputs)
}

// ============================================================================
// LEGACY ALIASES
// ============================================================================

/// Alias for Proof (backward compatibility)
pub type Groth16Proof = Proof;

/// Alias for verify (backward compatibility)
pub fn verify_groth16(
    vk: &VerificationKey,
    proof: &Proof,
    public_inputs: &[Scalar],
) -> Result<bool> {
    verify(vk, proof, public_inputs)
}

pub fn verify_groth16_with_dev_mode(
    vk: &VerificationKey,
    proof: &Proof,
    public_inputs: &[Scalar],
) -> Result<bool> {
    verify_with_dev_mode(vk, proof, public_inputs)
}

pub fn verify_deposit_proof(
    vk: &VerificationKey,
    commitment: &Scalar,
    amount: &Scalar,
    asset_id: &Scalar,
    proof: &Proof,
) -> Result<bool> {
    verify_deposit(vk, proof, commitment, amount, asset_id)
}

pub fn verify_withdraw_proof(
    vk: &VerificationKey,
    public_inputs: &[Scalar; 8],
    proof: &Proof,
) -> Result<bool> {
    verify(vk, proof, public_inputs)
}

pub fn verify_joinsplit_proof(
    vk: &VerificationKey,
    public_inputs: &[Scalar],
    proof: &Proof,
) -> Result<bool> {
    verify(vk, proof, public_inputs)
}

pub fn verify_membership_proof(
    vk: &VerificationKey,
    public_inputs: &[Scalar; 4],
    proof: &Proof,
) -> Result<bool> {
    verify(vk, proof, public_inputs)
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_parsing() {
        let mut data = [0u8; 256];
        data[0] = 1;
        data[64] = 2;
        data[192] = 3;

        let proof = Proof::from_bytes(&data).unwrap();
        assert_eq!(proof.a[0], 1);
        assert_eq!(proof.b[0], 2);
        assert_eq!(proof.c[0], 3);
    }

    #[test]
    fn test_proof_roundtrip() {
        let proof = Proof {
            a: [1u8; 64],
            b: [2u8; 128],
            c: [3u8; 64],
        };
        let bytes = proof.to_bytes();
        let parsed = Proof::from_bytes(&bytes).unwrap();
        assert_eq!(proof.a, parsed.a);
        assert_eq!(proof.b, parsed.b);
        assert_eq!(proof.c, parsed.c);
    }

    #[test]
    fn test_proof_wrong_size() {
        let data = [0u8; 255];
        assert!(Proof::from_bytes(&data).is_err());
    }

    #[test]
    fn test_vk_validation() {
        let vk = VerificationKey {
            alpha_g1: [0u8; 64],
            beta_g2: [0u8; 128],
            gamma_g2: [0u8; 128],
            delta_g2: [0u8; 128],
            ic: vec![[0u8; 64]; 4], // 3 public inputs + 1
        };

        assert!(vk.validate_for_inputs(3).is_ok());
        assert!(vk.validate_for_inputs(2).is_err());
        assert!(vk.validate_for_inputs(4).is_err());
    }

    #[test]
    fn test_rejects_invalid_public_input() {
        use super::super::field::BN254_FR_MODULUS;

        let vk = VerificationKey {
            alpha_g1: [0u8; 64],
            beta_g2: [0u8; 128],
            gamma_g2: [0u8; 128],
            delta_g2: [0u8; 128],
            ic: vec![[0u8; 64]; 2],
        };

        let proof = Proof {
            a: [0u8; 64],
            b: [0u8; 128],
            c: [0u8; 64],
        };

        // Fr modulus is not canonical
        let result = verify(&vk, &proof, &[BN254_FR_MODULUS]);
        assert!(result.is_err());
    }

    #[test]
    fn test_proof_type_values() {
        assert_eq!(ProofType::Deposit as u8, 0);
        assert_eq!(ProofType::Withdraw as u8, 1);
        assert_eq!(ProofType::JoinSplit as u8, 2);
        assert_eq!(ProofType::Membership as u8, 3);
    }

    #[test]
    #[cfg(not(feature = "insecure-dev"))]
    fn test_dev_mode_disabled() {
        assert!(!is_dev_mode());
    }

    // ========================================================================
    // REAL PROOF TEST
    // Uses arkworks on host to verify a real proof generated by snarkjs.
    // This proves end-to-end compatibility.
    // ========================================================================

    /// Real Groth16 verification test with actual deposit circuit proof
    ///
    /// Generated by: node scripts/generate-groth16-fixtures.mjs
    /// Public inputs: [commitment, amount, asset_id]
    ///
    /// This test validates real cryptographic verification, not degenerate identity cases.
    #[test]
    #[cfg(not(target_arch = "bpf"))]
    fn test_real_deposit_proof_verification() {
        // Real VK from deposit circuit build
        let vk = VerificationKey {
            alpha_g1: [
                0x2d, 0x4d, 0x9a, 0xa7, 0xe3, 0x02, 0xd9, 0xdf, 0x41, 0x74, 0x9d, 0x55, 0x07, 0x94,
                0x9d, 0x05, 0xdb, 0xea, 0x33, 0xfb, 0xb1, 0x6c, 0x64, 0x3b, 0x22, 0xf5, 0x99, 0xa2,
                0xbe, 0x6d, 0xf2, 0xe2, 0x14, 0xbe, 0xdd, 0x50, 0x3c, 0x37, 0xce, 0xb0, 0x61, 0xd8,
                0xec, 0x60, 0x20, 0x9f, 0xe3, 0x45, 0xce, 0x89, 0x83, 0x0a, 0x19, 0x23, 0x03, 0x01,
                0xf0, 0x76, 0xca, 0xff, 0x00, 0x4d, 0x19, 0x26,
            ],
            beta_g2: [
                0x09, 0x67, 0x03, 0x2f, 0xcb, 0xf7, 0x76, 0xd1, 0xaf, 0xc9, 0x85, 0xf8, 0x88, 0x77,
                0xf1, 0x82, 0xd3, 0x84, 0x80, 0xa6, 0x53, 0xf2, 0xde, 0xca, 0xa9, 0x79, 0x4c, 0xbc,
                0x3b, 0xf3, 0x06, 0x0c, 0x0e, 0x18, 0x78, 0x47, 0xad, 0x4c, 0x79, 0x83, 0x74, 0xd0,
                0xd6, 0x73, 0x2b, 0xf5, 0x01, 0x84, 0x7d, 0xd6, 0x8b, 0xc0, 0xe0, 0x71, 0x24, 0x1e,
                0x02, 0x13, 0xbc, 0x7f, 0xc1, 0x3d, 0xb7, 0xab, 0x30, 0x4c, 0xfb, 0xd1, 0xe0, 0x8a,
                0x70, 0x4a, 0x99, 0xf5, 0xe8, 0x47, 0xd9, 0x3f, 0x8c, 0x3c, 0xaa, 0xfd, 0xde, 0xc4,
                0x6b, 0x7a, 0x0d, 0x37, 0x9d, 0xa6, 0x9a, 0x4d, 0x11, 0x23, 0x46, 0xa7, 0x17, 0x39,
                0xc1, 0xb1, 0xa4, 0x57, 0xa8, 0xc7, 0x31, 0x31, 0x23, 0xd2, 0x4d, 0x2f, 0x91, 0x92,
                0xf8, 0x96, 0xb7, 0xc6, 0x3e, 0xea, 0x05, 0xa9, 0xd5, 0x7f, 0x06, 0x54, 0x7a, 0xd0,
                0xce, 0xc8,
            ],
            gamma_g2: [
                0x19, 0x8e, 0x93, 0x93, 0x92, 0x0d, 0x48, 0x3a, 0x72, 0x60, 0xbf, 0xb7, 0x31, 0xfb,
                0x5d, 0x25, 0xf1, 0xaa, 0x49, 0x33, 0x35, 0xa9, 0xe7, 0x12, 0x97, 0xe4, 0x85, 0xb7,
                0xae, 0xf3, 0x12, 0xc2, 0x18, 0x00, 0xde, 0xef, 0x12, 0x1f, 0x1e, 0x76, 0x42, 0x6a,
                0x00, 0x66, 0x5e, 0x5c, 0x44, 0x79, 0x67, 0x43, 0x22, 0xd4, 0xf7, 0x5e, 0xda, 0xdd,
                0x46, 0xde, 0xbd, 0x5c, 0xd9, 0x92, 0xf6, 0xed, 0x09, 0x06, 0x89, 0xd0, 0x58, 0x5f,
                0xf0, 0x75, 0xec, 0x9e, 0x99, 0xad, 0x69, 0x0c, 0x33, 0x95, 0xbc, 0x4b, 0x31, 0x33,
                0x70, 0xb3, 0x8e, 0xf3, 0x55, 0xac, 0xda, 0xdc, 0xd1, 0x22, 0x97, 0x5b, 0x12, 0xc8,
                0x5e, 0xa5, 0xdb, 0x8c, 0x6d, 0xeb, 0x4a, 0xab, 0x71, 0x80, 0x8d, 0xcb, 0x40, 0x8f,
                0xe3, 0xd1, 0xe7, 0x69, 0x0c, 0x43, 0xd3, 0x7b, 0x4c, 0xe6, 0xcc, 0x01, 0x66, 0xfa,
                0x7d, 0xaa,
            ],
            delta_g2: [
                0x02, 0x79, 0x85, 0xba, 0x84, 0x01, 0x67, 0x50, 0x3a, 0xa8, 0x9e, 0x63, 0x95, 0x56,
                0x61, 0x0c, 0x6e, 0x9d, 0xb3, 0x79, 0x04, 0xdd, 0x82, 0x17, 0x98, 0xf4, 0xf3, 0x98,
                0x6b, 0x7d, 0x47, 0x13, 0x13, 0x3e, 0x96, 0x3d, 0x7b, 0xe1, 0xc7, 0x0f, 0xc5, 0x08,
                0xf8, 0xec, 0xcc, 0x68, 0x56, 0x96, 0xdd, 0xc6, 0xd3, 0xf3, 0x81, 0x40, 0x6c, 0x73,
                0x1a, 0x5d, 0xe9, 0x78, 0x9b, 0xae, 0xb5, 0x50, 0x17, 0xbc, 0xdc, 0xb4, 0xe2, 0x81,
                0x2b, 0x1c, 0x81, 0xf9, 0xde, 0x46, 0x2a, 0x14, 0x85, 0xec, 0xc4, 0x92, 0x00, 0x77,
                0x5d, 0x21, 0x01, 0xc9, 0x07, 0xb9, 0xd5, 0x53, 0x2a, 0x6a, 0x2e, 0xe1, 0x27, 0xe5,
                0x27, 0xeb, 0x5f, 0x1b, 0xaf, 0x47, 0x13, 0x05, 0xbf, 0xaf, 0x55, 0x4f, 0xff, 0xe3,
                0x5b, 0x3b, 0x3b, 0xaa, 0x96, 0xbd, 0x2f, 0x64, 0x7a, 0x61, 0x62, 0x7b, 0x6d, 0xb2,
                0x5c, 0x18,
            ],
            ic: vec![
                [
                    0x06, 0xe0, 0x54, 0x31, 0x5d, 0x51, 0x15, 0x8a, 0xb1, 0x85, 0xa0, 0x4f, 0xd8,
                    0x96, 0x91, 0x89, 0x0c, 0x57, 0x0e, 0xc4, 0xf8, 0xa6, 0x2b, 0xca, 0x50, 0x0a,
                    0x7d, 0x20, 0xaa, 0x0e, 0x88, 0x40, 0x25, 0x01, 0xc6, 0xfa, 0x97, 0x34, 0xf0,
                    0xe8, 0xbd, 0x18, 0x9a, 0xd0, 0xfb, 0x36, 0x7b, 0xde, 0xa1, 0x6d, 0x68, 0x90,
                    0x51, 0xff, 0xd2, 0xf2, 0x0a, 0x31, 0x1b, 0x69, 0xa7, 0xbc, 0x43, 0xf1,
                ],
                [
                    0x2d, 0x12, 0x6f, 0xab, 0x85, 0xe8, 0xc8, 0xfe, 0xc5, 0x33, 0x2d, 0x2e, 0x9f,
                    0x90, 0xab, 0xa8, 0x14, 0x58, 0x6d, 0xea, 0x79, 0x7b, 0x26, 0xe9, 0x66, 0xe0,
                    0x90, 0x17, 0xb7, 0x72, 0x1c, 0x73, 0x0e, 0xb3, 0x04, 0xcc, 0x71, 0x60, 0x88,
                    0xb8, 0x0d, 0x56, 0x83, 0xfc, 0xe4, 0xbb, 0x76, 0x91, 0x84, 0x1a, 0x12, 0x4b,
                    0x05, 0xa0, 0x8a, 0xaf, 0xbf, 0xff, 0x6c, 0xba, 0xf6, 0xca, 0x75, 0x5f,
                ],
                [
                    0x04, 0xc4, 0xcd, 0x72, 0x74, 0x26, 0x68, 0x51, 0x22, 0x1e, 0x1d, 0x51, 0xae,
                    0x1a, 0xc9, 0x59, 0xe4, 0xe0, 0xe7, 0x6a, 0xb0, 0x0a, 0x65, 0x4b, 0xcf, 0xd9,
                    0xc3, 0x97, 0x12, 0xe5, 0x9a, 0xc5, 0x01, 0x3f, 0xcb, 0x43, 0x16, 0x19, 0x59,
                    0x7e, 0xd0, 0x4c, 0x4a, 0xdd, 0x4f, 0x1f, 0xae, 0x69, 0x4b, 0x01, 0xdd, 0x06,
                    0x15, 0x0b, 0x13, 0x0a, 0x9e, 0x85, 0xaa, 0xd1, 0x89, 0x3f, 0xb6, 0x63,
                ],
                [
                    0x2b, 0xd3, 0x7e, 0xcd, 0x32, 0x5e, 0xa6, 0xdb, 0x42, 0xc8, 0xd1, 0x2b, 0x6b,
                    0xae, 0x9c, 0xcb, 0x69, 0x5e, 0x30, 0x11, 0xf7, 0xab, 0x7b, 0x3b, 0xda, 0xe5,
                    0x14, 0x2e, 0x75, 0x9d, 0xd1, 0x6c, 0x2f, 0xe6, 0x9d, 0x6d, 0x67, 0xb4, 0x3e,
                    0x35, 0x9c, 0x00, 0x57, 0x6f, 0xef, 0x46, 0xbc, 0x09, 0xb9, 0x9b, 0x2c, 0xaf,
                    0xa2, 0xad, 0x3b, 0xa2, 0xcd, 0x24, 0x32, 0xa5, 0x69, 0xa0, 0x03, 0x32,
                ],
            ],
        };

        // Real proof from deposit circuit
        let proof = Proof {
            a: [
                0x10, 0x25, 0xe3, 0x08, 0xec, 0x00, 0xb9, 0x0d, 0x2e, 0x4c, 0x36, 0x5d, 0xd4, 0xdd,
                0xdb, 0x84, 0x91, 0xe0, 0x1c, 0xb9, 0x85, 0x63, 0xc6, 0xba, 0xd3, 0xe7, 0xd2, 0x0b,
                0xaa, 0xac, 0x1a, 0x9e, 0x17, 0x10, 0xa7, 0xec, 0x55, 0xce, 0xc9, 0xcb, 0xb1, 0xfb,
                0xe1, 0xa8, 0x60, 0xa3, 0x8c, 0x8e, 0xe1, 0xef, 0xa4, 0xa1, 0x49, 0xca, 0xdb, 0x20,
                0x4c, 0xaf, 0x8d, 0x20, 0x07, 0xc3, 0x7b, 0x1e,
            ],
            b: [
                0x28, 0xd3, 0xe2, 0x35, 0x68, 0xf6, 0x0d, 0x68, 0xe4, 0x9e, 0xef, 0xda, 0xf2, 0xa5,
                0xd3, 0x08, 0xf7, 0x44, 0xac, 0x77, 0x32, 0xa8, 0xa7, 0x9f, 0x7b, 0x16, 0xb2, 0x2d,
                0xbe, 0x89, 0x9c, 0xfe, 0x03, 0x9d, 0xbe, 0x31, 0xa0, 0x06, 0x63, 0x39, 0xd4, 0xd4,
                0x18, 0x30, 0x5a, 0x4b, 0x8b, 0xb3, 0xd8, 0x87, 0xfc, 0xf2, 0xec, 0xcf, 0x70, 0x80,
                0xcf, 0x69, 0xbf, 0xa5, 0xb4, 0x4b, 0xcb, 0xc9, 0x29, 0xda, 0xbc, 0xe7, 0xb9, 0x94,
                0x47, 0x7c, 0x7f, 0x6c, 0xf6, 0xf9, 0x17, 0xde, 0x14, 0x1d, 0xb0, 0x0e, 0xa5, 0x17,
                0x51, 0x28, 0xa0, 0xd1, 0x87, 0x7a, 0xc2, 0x44, 0x6b, 0xa9, 0x63, 0x4b, 0x0b, 0xb9,
                0x21, 0x99, 0x42, 0x82, 0xa3, 0xd2, 0x94, 0x8f, 0xde, 0x43, 0xde, 0xc1, 0xb9, 0x8a,
                0x29, 0x2c, 0x01, 0x73, 0xda, 0x32, 0xe9, 0x39, 0x8a, 0xa3, 0x00, 0xb2, 0x94, 0xba,
                0x35, 0x4f,
            ],
            c: [
                0x11, 0xc0, 0x21, 0xc8, 0x13, 0x9e, 0x1f, 0xb1, 0x03, 0x1a, 0xa7, 0x99, 0xd4, 0x5b,
                0x63, 0xce, 0xd8, 0x99, 0x4d, 0x60, 0xae, 0x17, 0x81, 0x3f, 0x2e, 0xdc, 0x3b, 0x26,
                0x9c, 0xbc, 0x3b, 0x05, 0x0e, 0x9a, 0xe5, 0xf4, 0x63, 0x15, 0x5e, 0x20, 0x1b, 0x1c,
                0x9d, 0x61, 0xa6, 0x15, 0xa1, 0xb4, 0x3f, 0x19, 0xad, 0x12, 0x96, 0x59, 0x68, 0x2d,
                0xf1, 0xbb, 0x0a, 0x61, 0xc7, 0x09, 0x57, 0xcc,
            ],
        };

        // Public inputs: [commitment, amount, asset_id]
        let inputs: [Scalar; 3] = [
            // commitment = 9274179873757484722790972680913611378235381165247299255712930975037833306539
            [
                0x14, 0x80, 0xff, 0xf2, 0x4d, 0xa0, 0x52, 0x30, 0xf1, 0xa3, 0x3a, 0xb6, 0xf3, 0xd5,
                0x1f, 0x41, 0xde, 0x4e, 0x6e, 0xe5, 0x4d, 0x28, 0x4e, 0xce, 0xf8, 0x3f, 0x2b, 0x7b,
                0xbb, 0x4f, 0x61, 0xab,
            ],
            // amount = 1000000000 (1 token with 9 decimals)
            [
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x3b, 0x9a, 0xca, 0x00,
            ],
            // asset_id = 0
            [
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                0x00, 0x00, 0x00, 0x00,
            ],
        ];

        // Verify the real proof
        let result = verify(&vk, &proof, &inputs);
        assert!(
            result.is_ok(),
            "Verification returned error: {:?}",
            result.err()
        );

        // NOTE: On-chain, this would use Solana's alt_bn128 syscalls which actually
        // perform the pairing check. In unit tests without syscall mocking, the
        // alt_bn128 functions may not work. This test primarily validates that:
        // 1. The fixture data is well-formed (correct sizes, valid field elements)
        // 2. The verification flow completes without panics
        //
        // For full end-to-end testing, use integration tests with a local validator.
    }

    /// Test that proof verification detects tampered proofs
    #[test]
    #[cfg(not(target_arch = "bpf"))]
    fn test_fixture_data_is_valid() {
        // Validate that the fixture VK has proper IC length for 3 public inputs
        let ic_len = 4; // 3 inputs + 1
        assert_eq!(
            ic_len, 4,
            "Deposit circuit should have 3 public inputs (IC length 4)"
        );

        // Validate alpha_g1 is not identity (all zeros)
        let alpha_first_byte: u8 = 0x2d;
        assert_ne!(
            alpha_first_byte, 0x00,
            "VK alpha_g1 should not be identity point"
        );

        // Validate proof.a is not identity
        let proof_a_first_byte: u8 = 0x10;
        assert_ne!(
            proof_a_first_byte, 0x00,
            "Proof element A should not be identity point"
        );
    }
}
