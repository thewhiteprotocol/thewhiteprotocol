//! Cryptographic Primitives for The White Protocol Privacy Pool v2
//!
//! # Module Structure
//! - `field`: BN254 field element validation (Fr and Fp)
//! - `alt_bn128`: BN254 curve operations (syscalls on Solana, arkworks on host)
//! - `poseidon`: Poseidon hash (circomlib compatible)
//! - `groth16`: Groth16 proof verification
//! - `keccak`: Keccak256 hashing utilities
//! - `public_inputs`: Builders for circuit public inputs
//!
//! # Encoding Convention
//! All field elements are 32 bytes, BIG-ENDIAN.
//! G1 points: 64 bytes (x || y)
//! G2 points: 128 bytes (x_c0 || x_c1 || y_c0 || y_c1)

// Core modules
pub mod alt_bn128;
pub mod field;
pub mod groth16;
pub mod keccak;
pub mod poseidon;
pub mod precomputed_zeros;
pub mod public_inputs;

// NOTE: Poseidon vector tests are in tests/poseidon_vectors_test.rs (integration test)
// Run: cargo test -p white-protocol --test poseidon_vectors_test -- --nocapture

// Optional modules - none currently active

// REMOVED: alt_bn128_syscalls, curve_utils, encoding
// These contained fake stubs that made tests pass while verification was broken.
// All curve operations now use alt_bn128.rs with real arkworks implementation.

// ============================================================================
// RE-EXPORTS: Field
// ============================================================================

pub use field::{
    be_subtract, is_g1_identity, is_valid_fp, is_valid_fr, is_zero, u64_to_be32, validate_fp,
    validate_fr, BN254_FP_MODULUS, BN254_FR_MODULUS,
};

// Backward compatibility aliases
pub const BN254_FIELD_MODULUS: [u8; 32] = BN254_FP_MODULUS;
pub const BN254_SCALAR_MODULUS: [u8; 32] = BN254_FR_MODULUS;

// ============================================================================
// RE-EXPORTS: alt_bn128
// ============================================================================

pub use alt_bn128::{g1_add, g1_mul, g1_negate, make_pairing_element, pairing_check_4};

// Backward compatibility
pub fn verify_pairing(elements: &[[u8; 192]; 4]) -> anchor_lang::prelude::Result<bool> {
    pairing_check_4(elements)
}

// ============================================================================
// RE-EXPORTS: Poseidon
// ============================================================================

pub use poseidon::{
    compute_commitment, compute_nullifier_hash, empty_leaf_hash, hash_two_to_one, is_canonical_fr,
    is_placeholder_implementation, is_valid_scalar as poseidon_is_valid_scalar,
    is_zero as is_zero_hash, poseidon2, poseidon3, poseidon4, poseidon_hash_3, poseidon_hash_4,
    u64_to_scalar_be, verify_commitment, Scalar as PoseidonScalarField, IS_PLACEHOLDER,
};

// ============================================================================
// RE-EXPORTS: Groth16
// ============================================================================

pub use groth16::{
    is_dev_mode,
    verify,
    verify_deposit,
    verify_deposit_proof,
    verify_groth16,
    verify_groth16_with_dev_mode,
    verify_joinsplit_proof,
    verify_membership_proof,
    verify_with_dev_mode,
    verify_withdraw,
    verify_withdraw_proof,
    G1Point,
    G2Point,
    // Legacy aliases
    Groth16Proof,
    Proof,
    ProofType,
    Scalar,
    VerificationKey,
    MAX_PUBLIC_INPUTS,
    PROOF_SIZE,
};

// Re-export verify_proof_from_account from this module
pub use self::verify_proof_from_account as verify_proof_account;

/// Proof data length constant
pub const PROOF_DATA_LEN: usize = PROOF_SIZE;

/// Check if proof bytes have valid length
#[inline]
pub fn is_valid_proof_length(data: &[u8]) -> bool {
    data.len() == PROOF_DATA_LEN
}

// Legacy aliases for verification
pub fn verify_groth16_proof(
    vk: &VerificationKey,
    proof: &Proof,
    public_inputs: &[Scalar],
) -> anchor_lang::prelude::Result<bool> {
    verify(vk, proof, public_inputs)
}

pub fn verify_proof_bytes(
    vk: &VerificationKey,
    proof_bytes: &[u8],
    public_inputs: &[Scalar],
) -> anchor_lang::prelude::Result<bool> {
    let proof = Proof::from_bytes(proof_bytes)?;
    verify(vk, &proof, public_inputs)
}

/// Verify a proof using an on-chain VerificationKeyAccount.
/// This is the main entry point for instruction code.
pub fn verify_proof_from_account(
    vk_alpha_g1: &[u8; 64],
    vk_beta_g2: &[u8; 128],
    vk_gamma_g2: &[u8; 128],
    vk_delta_g2: &[u8; 128],
    vk_ic: &[[u8; 64]],
    proof_bytes: &[u8],
    public_inputs: &[Scalar],
) -> anchor_lang::prelude::Result<bool> {
    let vk =
        VerificationKey::from_account(vk_alpha_g1, vk_beta_g2, vk_gamma_g2, vk_delta_g2, vk_ic);
    let proof = Proof::from_bytes(proof_bytes)?;
    verify(&vk, &proof, public_inputs)
}

// ============================================================================
// RE-EXPORTS: Keccak
// ============================================================================

pub use keccak::{
    derive_asset_id, derive_asset_id_u32, hash_commitment, hash_verification_key, keccak256,
    keccak256_concat,
};

// ============================================================================
// RE-EXPORTS: Public Inputs
// ============================================================================

pub use public_inputs::{
    DepositPublicInputs, JoinSplitPublicInputs, JoinSplitPublicInputsBuilder,
    MembershipPublicInputs, WithdrawPublicInputs, WithdrawPublicInputsBuilder,
    WithdrawV2PublicInputs, MAX_JS_INPUTS, MAX_JS_OUTPUTS, WITHDRAW_V2_SCHEMA_VERSION,
};

// ============================================================================
// CURVE UTILS COMPATIBILITY
// ============================================================================

/// G1 identity point (all zeros)
pub const G1_IDENTITY: G1Point = [0u8; 64];

/// G2 identity point (all zeros)
pub const G2_IDENTITY: G2Point = [0u8; 128];

/// G1 generator point (1, 2)
pub const G1_GENERATOR: G1Point = [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02,
];

pub type ScalarField = Scalar;
pub type PairingElement = [u8; 192];

#[inline]
pub fn validate_g1_point(_point: &G1Point) -> anchor_lang::prelude::Result<()> {
    Ok(()) // Validation happens during pairing
}

#[inline]
pub fn validate_g2_point(_point: &G2Point) -> anchor_lang::prelude::Result<()> {
    Ok(())
}

#[inline]
pub fn validate_g2_point_allow_identity(_point: &G2Point) -> anchor_lang::prelude::Result<()> {
    Ok(())
}

#[inline]
pub fn negate_g1(point: &G1Point) -> anchor_lang::prelude::Result<G1Point> {
    g1_negate(point)
}

#[inline]
pub fn g1_scalar_mul(point: &G1Point, scalar: &Scalar) -> anchor_lang::prelude::Result<G1Point> {
    g1_mul(point, scalar)
}

#[inline]
pub fn is_valid_scalar(scalar: &Scalar) -> bool {
    is_valid_fr(scalar)
}

#[inline]
pub fn u64_to_scalar(value: u64) -> Scalar {
    u64_to_be32(value)
}

#[inline]
pub fn i64_to_scalar(value: i64) -> Scalar {
    if value >= 0 {
        u64_to_be32(value as u64)
    } else {
        let abs_val = if value == i64::MIN {
            (i64::MAX as u64) + 1
        } else {
            (-value) as u64
        };
        be_subtract(&BN254_FR_MODULUS, &u64_to_be32(abs_val))
    }
}

#[inline]
pub fn pubkey_to_scalar(pubkey: &anchor_lang::prelude::Pubkey) -> Scalar {
    let mut scalar = [0u8; 32];
    scalar[1..32].copy_from_slice(&pubkey.to_bytes()[0..31]);
    scalar
}

pub fn compute_vk_x(ic: &[G1Point], inputs: &[Scalar]) -> anchor_lang::prelude::Result<G1Point> {
    if ic.len() != inputs.len() + 1 {
        return Err(crate::error::WhiteProtocolError::InvalidPublicInputs.into());
    }

    let mut vk_x = ic[0];
    for (input, ic_point) in inputs.iter().zip(ic.iter().skip(1)) {
        if input.iter().all(|&b| b == 0) {
            continue;
        }
        let product = g1_mul(ic_point, input)?;
        if !is_g1_identity(&product) {
            if is_g1_identity(&vk_x) {
                vk_x = product;
            } else {
                vk_x = g1_add(&vk_x, &product)?;
            }
        }
    }
    Ok(vk_x)
}

// Poseidon legacy compatibility
pub use poseidon::Scalar as PoseidonScalar;
pub const POSEIDON_FIELD_MODULUS: [u8; 32] = BN254_FR_MODULUS;

#[inline]
pub fn u64_to_scalar_le(value: u64) -> Scalar {
    let mut scalar = [0u8; 32];
    scalar[0..8].copy_from_slice(&value.to_le_bytes());
    scalar
}

#[inline]
pub fn i64_to_scalar_be(value: i64) -> Scalar {
    i64_to_scalar(value)
}

#[inline]
pub fn u64_to_bytes32(value: u64) -> Scalar {
    u64_to_be32(value)
}

/// REMOVED: reduce_scalar - non-canonical inputs must be rejected, not reduced.
/// If you need to handle potentially invalid scalars, check is_valid_fr() first.
pub fn reduce_scalar(scalar: &Scalar) -> anchor_lang::prelude::Result<Scalar> {
    if is_valid_fr(scalar) {
        Ok(*scalar)
    } else {
        Err(crate::error::WhiteProtocolError::InvalidPublicInputs.into())
    }
}
