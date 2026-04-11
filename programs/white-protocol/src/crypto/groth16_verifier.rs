//! Groth16 Proof Verifier for The White Protocol v2
//!
//! This module implements Groth16 zkSNARK proof verification using Solana's
//! alt_bn128 precompiles (BN254/alt_bn128 curve).
//!
//! # Overview
//!
//! The verifier supports multiple proof types as defined in the The White Protocol v2 protocol:
//! - **Deposit**: Proves valid commitment construction
//! - **Withdraw**: Proves Merkle membership and nullifier computation
//! - **JoinSplit**: Proves value conservation in private transfers
//! - **Membership**: Proves stake threshold without spending
//!
//! # Implementation Status
//!
//! This implementation is adapted from The White Protocol v1 and extended for v2 features.
//! The core verification logic is functional, but the following items remain
//! for production readiness:
//! - Security audit of pairing operations
//! - Gas optimization for complex proofs
//! - Extended test coverage with production VKs
//!
//! # Security Considerations
//!
//! - Verification is fail-closed: any error results in rejection
//! - All curve points are validated before use
//! - Invalid proofs never return `Ok(true)`
//!
//! # References
//!
//! - Groth16: https://eprint.iacr.org/2016/260
//! - BN254 curve parameters
//! - Solana alt_bn128 precompile documentation

use anchor_lang::prelude::*;

use crate::error::WhiteProtocolError;
use crate::state::VerificationKeyAccount;

use super::curve_utils::{
    G1Point, G2Point, ScalarField,
    validate_g1_point, validate_g2_point,
    negate_g1, compute_vk_x, verify_pairing, make_pairing_element,
    is_valid_scalar,
};

// ============================================================================
// CONSTANTS
// ============================================================================

/// Groth16 proof size in bytes (A: 64 + B: 128 + C: 64 = 256)
pub const PROOF_DATA_LEN: usize = 256;

// ============================================================================
// PROOF STRUCTURE
// ============================================================================

/// Groth16 proof consisting of three curve points.
///
/// # Encoding
/// - `A`: G1 point (64 bytes, uncompressed)
/// - `B`: G2 point (128 bytes, uncompressed)
/// - `C`: G1 point (64 bytes, uncompressed)
///
/// Total size: 256 bytes
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct Groth16Proof {
    /// π_A ∈ G1 - First proof element
    pub a: G1Point,
    /// π_B ∈ G2 - Second proof element
    pub b: G2Point,
    /// π_C ∈ G1 - Third proof element
    pub c: G1Point,
}

impl Groth16Proof {
    /// Total size of serialized proof
    pub const SIZE: usize = PROOF_DATA_LEN;

    /// Deserialize proof from raw bytes.
    ///
    /// # Arguments
    /// * `data` - Raw proof bytes (must be exactly 256 bytes)
    ///
    /// # Returns
    /// * `Ok(Groth16Proof)` - Successfully parsed proof
    /// * `Err` - Invalid format or length
    pub fn from_bytes(data: &[u8]) -> Result<Self> {
        if data.len() != Self::SIZE {
            msg!(
                "Invalid proof size: expected {}, got {}",
                Self::SIZE,
                data.len()
            );
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

    /// Serialize proof to bytes.
    pub fn to_bytes(&self) -> [u8; 256] {
        let mut bytes = [0u8; 256];
        bytes[0..64].copy_from_slice(&self.a);
        bytes[64..192].copy_from_slice(&self.b);
        bytes[192..256].copy_from_slice(&self.c);
        bytes
    }

    /// Validate that all proof points are valid curve points.
    ///
    /// This checks:
    /// - A is a valid G1 point
    /// - B is a valid G2 point (basic check)
    /// - C is a valid G1 point
    pub fn validate(&self) -> Result<()> {
        validate_g1_point(&self.a).map_err(|_| {
            msg!("Proof point A is not on curve");
            error!(WhiteProtocolError::InvalidProof)
        })?;

        validate_g2_point(&self.b).map_err(|_| {
            msg!("Proof point B is not on curve");
            error!(WhiteProtocolError::InvalidProof)
        })?;

        validate_g1_point(&self.c).map_err(|_| {
            msg!("Proof point C is not on curve");
            error!(WhiteProtocolError::InvalidProof)
        })?;

        Ok(())
    }
}

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

/// Verify a Groth16 proof against a verification key and public inputs.
///
/// # Verification Equation
///
/// The Groth16 verification checks:
/// ```text
/// e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ)
/// ```
///
/// Where `vk_x = Σ(public_input[i] · IC[i])` is the public input accumulator.
///
/// This is equivalent to checking:
/// ```text
/// e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
/// ```
///
/// # Arguments
/// * `vk` - Verification key account containing curve points
/// * `proof` - The Groth16 proof (A, B, C)
/// * `public_inputs` - Array of scalar field elements
///
/// # Returns
/// * `Ok(true)` - Proof is valid
/// * `Ok(false)` - Proof is invalid (verification failed)
/// * `Err(...)` - Error during verification (malformed inputs, etc.)
///
/// # Security
/// - Never returns `Ok(true)` for invalid proofs
/// - All errors result in rejection
/// - Verifies VK integrity before use
pub fn verify_groth16_proof(
    vk: &VerificationKeyAccount,
    proof: &Groth16Proof,
    public_inputs: &[ScalarField],
) -> Result<bool> {
    // Step 1: Validate VK is properly initialized
    if !vk.is_initialized {
        msg!("Verification key not initialized");
        return Err(WhiteProtocolError::VerificationKeyNotSet.into());
    }

    if !vk.is_valid() {
        msg!("Verification key is invalid");
        return Err(WhiteProtocolError::VerificationKeyNotSet.into());
    }

    // Step 1b: Verify VK integrity (hash check)
    if !vk.verify_integrity() {
        msg!("Verification key integrity check failed");
        return Err(WhiteProtocolError::CorruptedData.into());
    }

    // Step 2: Validate proof points
    proof.validate()?;

    // Step 3: Check public inputs count matches VK
    let expected_inputs = vk.vk_ic.len().saturating_sub(1);
    if public_inputs.len() != expected_inputs {
        msg!(
            "Public inputs count mismatch: expected {}, got {}",
            expected_inputs,
            public_inputs.len()
        );
        return Err(WhiteProtocolError::InvalidPublicInputs.into());
    }

    // Step 3b: Validate all public inputs are valid scalars
    for (i, input) in public_inputs.iter().enumerate() {
        if !is_valid_scalar(input) {
            msg!("Public input {} is not a valid scalar", i);
            return Err(WhiteProtocolError::InvalidPublicInputs.into());
        }
    }

    // Step 4: Compute vk_x = IC[0] + Σ(public_input[i] × IC[i+1])
    let vk_x = compute_vk_x(&vk.vk_ic, public_inputs).map_err(|e| {
        msg!("Failed to compute vk_x: {:?}", e);
        e
    })?;

    // Step 5: Negate proof.A for the pairing check
    let neg_a = negate_g1(&proof.a).map_err(|e| {
        msg!("Failed to negate proof.A: {:?}", e);
        e
    })?;

    // Step 6: Build pairing elements
    // e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
    let pairing_elements = [
        make_pairing_element(&neg_a, &proof.b),      // e(-A, B)
        make_pairing_element(&vk.vk_alpha_g1, &vk.vk_beta_g2),  // e(α, β)
        make_pairing_element(&vk_x, &vk.vk_gamma_g2),           // e(vk_x, γ)
        make_pairing_element(&proof.c, &vk.vk_delta_g2),        // e(C, δ)
    ];

    // Step 7: Verify the multi-pairing equation
    let is_valid = verify_pairing(&pairing_elements).map_err(|e| {
        msg!("Pairing verification failed: {:?}", e);
        e
    })?;

    if !is_valid {
        msg!("Proof verification failed: pairing check returned false");
    }

    Ok(is_valid)
}

/// Verify proof with raw bytes (convenience wrapper).
///
/// Parses the proof bytes and delegates to `verify_groth16_proof`.
///
/// # Arguments
/// * `vk` - Verification key account
/// * `proof_bytes` - Raw proof data (256 bytes)
/// * `public_inputs` - Array of scalar field elements
///
/// # Returns
/// Same as `verify_groth16_proof`
pub fn verify_proof_bytes(
    vk: &VerificationKeyAccount,
    proof_bytes: &[u8],
    public_inputs: &[ScalarField],
) -> Result<bool> {
    let proof = Groth16Proof::from_bytes(proof_bytes)?;
    verify_groth16_proof(vk, &proof, public_inputs)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Check if proof bytes have valid length.
#[inline]
pub fn is_valid_proof_length(data: &[u8]) -> bool {
    data.len() == PROOF_DATA_LEN
}

// ============================================================================
// TESTS
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_proof_size_constant() {
        assert_eq!(Groth16Proof::SIZE, 256);
        assert_eq!(PROOF_DATA_LEN, 256);
    }

    #[test]
    fn test_proof_from_bytes_valid_length() {
        let data = [0u8; 256];
        let result = Groth16Proof::from_bytes(&data);
        assert!(result.is_ok());
    }

    #[test]
    fn test_proof_from_bytes_invalid_length() {
        let short_data = [0u8; 100];
        let result = Groth16Proof::from_bytes(&short_data);
        assert!(result.is_err());

        let long_data = [0u8; 300];
        let result = Groth16Proof::from_bytes(&long_data);
        assert!(result.is_err());
    }

    #[test]
    fn test_proof_roundtrip() {
        let mut original = [0u8; 256];
        for (i, byte) in original.iter_mut().enumerate() {
            *byte = i as u8;
        }

        let proof = Groth16Proof::from_bytes(&original).unwrap();
        let serialized = proof.to_bytes();

        assert_eq!(original, serialized);
    }

    #[test]
    fn test_is_valid_proof_length() {
        assert!(is_valid_proof_length(&[0u8; 256]));
        assert!(!is_valid_proof_length(&[0u8; 255]));
        assert!(!is_valid_proof_length(&[0u8; 257]));
        assert!(!is_valid_proof_length(&[]));
    }
}
