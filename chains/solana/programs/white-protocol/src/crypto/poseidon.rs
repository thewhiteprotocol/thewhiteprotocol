#![allow(clippy::identity_op)]
//! Poseidon (circomlib) for BN254 scalar field, Solana/BPF-safe.
//!
//! Key properties:
//! - No `light_poseidon` parameter constructors (avoids BPF stack overflow).
//! - Constants are embedded as `[u8; 32]` big-endian and converted on the fly.
//! - Implements the same round structure as circomlib's optimized Poseidon.
//!
//! This module is deterministic and compatible with circomlibjs vectors.
//!
//! STACK OPTIMIZATION NOTES (Solana BPF limit: 4096 bytes per frame):
//! - All mix functions are #[inline(never)] to prevent frame bloat
//! - Constants accessed by reference, never copied
//! - Permutation functions are #[inline(never)]
use ark_ff::{AdditiveGroup, BigInteger, Field, PrimeField};

include!("poseidon_bn254_constants_fr.in.rs");

/// Convert big-endian bytes to Fr.
#[inline(never)]
fn fr_from_be32(b: &[u8; 32]) -> Fr {
    Fr::from_be_bytes_mod_order(b)
}

/// x^5 S-box
#[inline(never)]
fn sigma5(x: Fr) -> Fr {
    let x2 = x.square();
    let x4 = x2.square();
    x4 * x
}

/// Convert Fr to canonical big-endian bytes
#[inline(never)]
fn fr_to_be32(x: &Fr) -> [u8; 32] {
    let bi = x.into_bigint();
    let bytes_le = bi.to_bytes_le();
    let mut out = [0u8; 32];
    let n = core::cmp::min(out.len(), bytes_le.len());
    out[..n].copy_from_slice(&bytes_le[..n]);
    out.reverse();
    out
}

// =============================================================================
// SINGLE-TERM ACCUMULATION HELPER
// =============================================================================

#[inline(never)]
fn acc_term(acc: &mut Fr, coeff: &Fr, state_val: Fr) {
    *acc += (*coeff) * state_val;
}

// =============================================================================
// MIX FUNCTIONS - circomlibjs convention: new_state[i] = Σⱼ M[j][i] * state[j]
// =============================================================================

#[inline(never)]
fn mix_dense_t3(state: &mut [Fr; 3], m: &[[Fr; 3]; 3]) {
    let s0 = state[0];
    let s1 = state[1];
    let s2 = state[2];

    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][0], s0);
        acc_term(&mut acc, &m[1][0], s1);
        acc_term(&mut acc, &m[2][0], s2);
        state[0] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][1], s0);
        acc_term(&mut acc, &m[1][1], s1);
        acc_term(&mut acc, &m[2][1], s2);
        state[1] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][2], s0);
        acc_term(&mut acc, &m[1][2], s1);
        acc_term(&mut acc, &m[2][2], s2);
        state[2] = acc;
    }
}

#[inline(never)]
fn mix_dense_t4(state: &mut [Fr; 4], m: &[[Fr; 4]; 4]) {
    let s0 = state[0];
    let s1 = state[1];
    let s2 = state[2];
    let s3 = state[3];

    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][0], s0);
        acc_term(&mut acc, &m[1][0], s1);
        acc_term(&mut acc, &m[2][0], s2);
        acc_term(&mut acc, &m[3][0], s3);
        state[0] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][1], s0);
        acc_term(&mut acc, &m[1][1], s1);
        acc_term(&mut acc, &m[2][1], s2);
        acc_term(&mut acc, &m[3][1], s3);
        state[1] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][2], s0);
        acc_term(&mut acc, &m[1][2], s1);
        acc_term(&mut acc, &m[2][2], s2);
        acc_term(&mut acc, &m[3][2], s3);
        state[2] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][3], s0);
        acc_term(&mut acc, &m[1][3], s1);
        acc_term(&mut acc, &m[2][3], s2);
        acc_term(&mut acc, &m[3][3], s3);
        state[3] = acc;
    }
}

#[inline(never)]
fn mix_dense_t5(state: &mut [Fr; 5], m: &[[Fr; 5]; 5]) {
    let s0 = state[0];
    let s1 = state[1];
    let s2 = state[2];
    let s3 = state[3];
    let s4 = state[4];

    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][0], s0);
        acc_term(&mut acc, &m[1][0], s1);
        acc_term(&mut acc, &m[2][0], s2);
        acc_term(&mut acc, &m[3][0], s3);
        acc_term(&mut acc, &m[4][0], s4);
        state[0] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][1], s0);
        acc_term(&mut acc, &m[1][1], s1);
        acc_term(&mut acc, &m[2][1], s2);
        acc_term(&mut acc, &m[3][1], s3);
        acc_term(&mut acc, &m[4][1], s4);
        state[1] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][2], s0);
        acc_term(&mut acc, &m[1][2], s1);
        acc_term(&mut acc, &m[2][2], s2);
        acc_term(&mut acc, &m[3][2], s3);
        acc_term(&mut acc, &m[4][2], s4);
        state[2] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][3], s0);
        acc_term(&mut acc, &m[1][3], s1);
        acc_term(&mut acc, &m[2][3], s2);
        acc_term(&mut acc, &m[3][3], s3);
        acc_term(&mut acc, &m[4][3], s4);
        state[3] = acc;
    }
    {
        let mut acc = Fr::ZERO;
        acc_term(&mut acc, &m[0][4], s0);
        acc_term(&mut acc, &m[1][4], s1);
        acc_term(&mut acc, &m[2][4], s2);
        acc_term(&mut acc, &m[3][4], s3);
        acc_term(&mut acc, &m[4][4], s4);
        state[4] = acc;
    }
}

// =============================================================================
// SPARSE MIX FUNCTIONS (for partial rounds)
// circomlibjs: s0 = Σⱼ S[r*(2t-1)+j]*state[j], then state[k] += state[0]*S[r*(2t-1)+t+k-1]
// =============================================================================

#[inline(never)]
fn mix_s_t3(state: &mut [Fr; 3], s_chunk: &[Fr]) {
    let in0 = state[0];
    let in1 = state[1];
    let in2 = state[2];

    // s0 = in0*S[0] + in1*S[1] + in2*S[2]
    let mut s0 = Fr::ZERO;
    acc_term(&mut s0, &s_chunk[0], in0);
    acc_term(&mut s0, &s_chunk[1], in1);
    acc_term(&mut s0, &s_chunk[2], in2);

    // state[1] = in1 + in0*S[3]
    let mut new1 = in1;
    acc_term(&mut new1, &s_chunk[3], in0);

    // state[2] = in2 + in0*S[4]
    let mut new2 = in2;
    acc_term(&mut new2, &s_chunk[4], in0);

    state[0] = s0;
    state[1] = new1;
    state[2] = new2;
}

#[inline(never)]
fn mix_s_t4(state: &mut [Fr; 4], s_chunk: &[Fr]) {
    let in0 = state[0];
    let in1 = state[1];
    let in2 = state[2];
    let in3 = state[3];

    let mut s0 = Fr::ZERO;
    acc_term(&mut s0, &s_chunk[0], in0);
    acc_term(&mut s0, &s_chunk[1], in1);
    acc_term(&mut s0, &s_chunk[2], in2);
    acc_term(&mut s0, &s_chunk[3], in3);

    let mut new1 = in1;
    acc_term(&mut new1, &s_chunk[4], in0);

    let mut new2 = in2;
    acc_term(&mut new2, &s_chunk[5], in0);

    let mut new3 = in3;
    acc_term(&mut new3, &s_chunk[6], in0);

    state[0] = s0;
    state[1] = new1;
    state[2] = new2;
    state[3] = new3;
}

#[inline(never)]
fn mix_s_t5(state: &mut [Fr; 5], s_chunk: &[Fr]) {
    let in0 = state[0];
    let in1 = state[1];
    let in2 = state[2];
    let in3 = state[3];
    let in4 = state[4];

    let mut s0 = Fr::ZERO;
    acc_term(&mut s0, &s_chunk[0], in0);
    acc_term(&mut s0, &s_chunk[1], in1);
    acc_term(&mut s0, &s_chunk[2], in2);
    acc_term(&mut s0, &s_chunk[3], in3);
    acc_term(&mut s0, &s_chunk[4], in4);

    let mut new1 = in1;
    acc_term(&mut new1, &s_chunk[5], in0);

    let mut new2 = in2;
    acc_term(&mut new2, &s_chunk[6], in0);

    let mut new3 = in3;
    acc_term(&mut new3, &s_chunk[7], in0);

    let mut new4 = in4;
    acc_term(&mut new4, &s_chunk[8], in0);

    state[0] = s0;
    state[1] = new1;
    state[2] = new2;
    state[3] = new3;
    state[4] = new4;
}

// =============================================================================
// ARK (Add Round Key) FUNCTIONS
// =============================================================================

#[inline(never)]
fn ark_t3(state: &mut [Fr; 3], c: &[Fr], off: usize) {
    state[0] += c[off + 0];
    state[1] += c[off + 1];
    state[2] += c[off + 2];
}

#[inline(never)]
fn ark_t4(state: &mut [Fr; 4], c: &[Fr], off: usize) {
    state[0] += c[off + 0];
    state[1] += c[off + 1];
    state[2] += c[off + 2];
    state[3] += c[off + 3];
}

#[inline(never)]
fn ark_t5(state: &mut [Fr; 5], c: &[Fr], off: usize) {
    state[0] += c[off + 0];
    state[1] += c[off + 1];
    state[2] += c[off + 2];
    state[3] += c[off + 3];
    state[4] += c[off + 4];
}

// =============================================================================
// SBOX FUNCTIONS
// =============================================================================

#[inline(never)]
fn sbox_full_t3(state: &mut [Fr; 3]) {
    state[0] = sigma5(state[0]);
    state[1] = sigma5(state[1]);
    state[2] = sigma5(state[2]);
}

#[inline(never)]
fn sbox_full_t4(state: &mut [Fr; 4]) {
    state[0] = sigma5(state[0]);
    state[1] = sigma5(state[1]);
    state[2] = sigma5(state[2]);
    state[3] = sigma5(state[3]);
}

#[inline(never)]
fn sbox_full_t5(state: &mut [Fr; 5]) {
    state[0] = sigma5(state[0]);
    state[1] = sigma5(state[1]);
    state[2] = sigma5(state[2]);
    state[3] = sigma5(state[3]);
    state[4] = sigma5(state[4]);
}

// =============================================================================
// PERMUTATION FUNCTIONS
//
// circomlibjs round structure (nRoundsF=8):
// 1. Initial ARK: state += C[0..t]
// 2. First half - 1 (3 rounds): SBOX → ARK → MIX(M)
// 3. 1 round with P: SBOX → ARK → MIX(P)
// 4. Partial rounds (nRoundsP): SBOX[0] → ARK[0] → MIX_S
// 5. Second half - 1 (3 rounds): SBOX → ARK → MIX(M)
// 6. Final round: SBOX → MIX(M) (NO ARK!)
// =============================================================================

#[inline(never)]
fn poseidon_ex_t3(a: Fr, b: Fr) -> Fr {
    let mut state = [Fr::ZERO, a, b];
    let t = 3;

    // 1. Initial ARK
    ark_t3(&mut state, &C_T3, 0);

    // 2. First half - 1 (3 rounds with M)
    for r in 0..(N_ROUNDS_F / 2 - 1) {
        sbox_full_t3(&mut state);
        ark_t3(&mut state, &C_T3, (r + 1) * t);
        mix_dense_t3(&mut state, &M_T3);
    }

    // 3. One round with P matrix
    sbox_full_t3(&mut state);
    ark_t3(&mut state, &C_T3, (N_ROUNDS_F / 2) * t);
    mix_dense_t3(&mut state, &P_T3);

    // 4. Partial rounds
    let c_part_base = (N_ROUNDS_F / 2 + 1) * t;
    for r in 0..N_ROUNDS_P_T3 {
        state[0] = sigma5(state[0]);
        state[0] += C_T3[c_part_base + r];
        mix_s_t3(&mut state, &S_T3[r * (t * 2 - 1)..]);
    }

    // 5. Second half - 1 (3 rounds with M)
    let c_full2_base = c_part_base + N_ROUNDS_P_T3;
    for r in 0..(N_ROUNDS_F / 2 - 1) {
        sbox_full_t3(&mut state);
        ark_t3(&mut state, &C_T3, c_full2_base + r * t);
        mix_dense_t3(&mut state, &M_T3);
    }

    // 6. Final round (NO ARK!)
    sbox_full_t3(&mut state);
    mix_dense_t3(&mut state, &M_T3);

    state[0]
}

#[inline(never)]
fn poseidon_ex_t4(a: Fr, b: Fr, c: Fr) -> Fr {
    let mut state = [Fr::ZERO, a, b, c];
    let t = 4;

    ark_t4(&mut state, &C_T4, 0);

    for r in 0..(N_ROUNDS_F / 2 - 1) {
        sbox_full_t4(&mut state);
        ark_t4(&mut state, &C_T4, (r + 1) * t);
        mix_dense_t4(&mut state, &M_T4);
    }

    sbox_full_t4(&mut state);
    ark_t4(&mut state, &C_T4, (N_ROUNDS_F / 2) * t);
    mix_dense_t4(&mut state, &P_T4);

    let c_part_base = (N_ROUNDS_F / 2 + 1) * t;
    for r in 0..N_ROUNDS_P_T4 {
        state[0] = sigma5(state[0]);
        state[0] += C_T4[c_part_base + r];
        mix_s_t4(&mut state, &S_T4[r * (t * 2 - 1)..]);
    }

    let c_full2_base = c_part_base + N_ROUNDS_P_T4;
    for r in 0..(N_ROUNDS_F / 2 - 1) {
        sbox_full_t4(&mut state);
        ark_t4(&mut state, &C_T4, c_full2_base + r * t);
        mix_dense_t4(&mut state, &M_T4);
    }

    sbox_full_t4(&mut state);
    mix_dense_t4(&mut state, &M_T4);

    state[0]
}

#[inline(never)]
fn poseidon_ex_t5(a: Fr, b: Fr, c: Fr, d: Fr) -> Fr {
    let mut state = [Fr::ZERO, a, b, c, d];
    let t = 5;

    ark_t5(&mut state, &C_T5, 0);

    for r in 0..(N_ROUNDS_F / 2 - 1) {
        sbox_full_t5(&mut state);
        ark_t5(&mut state, &C_T5, (r + 1) * t);
        mix_dense_t5(&mut state, &M_T5);
    }

    sbox_full_t5(&mut state);
    ark_t5(&mut state, &C_T5, (N_ROUNDS_F / 2) * t);
    mix_dense_t5(&mut state, &P_T5);

    let c_part_base = (N_ROUNDS_F / 2 + 1) * t;
    for r in 0..N_ROUNDS_P_T5 {
        state[0] = sigma5(state[0]);
        state[0] += C_T5[c_part_base + r];
        mix_s_t5(&mut state, &S_T5[r * (t * 2 - 1)..]);
    }

    let c_full2_base = c_part_base + N_ROUNDS_P_T5;
    for r in 0..(N_ROUNDS_F / 2 - 1) {
        sbox_full_t5(&mut state);
        ark_t5(&mut state, &C_T5, c_full2_base + r * t);
        mix_dense_t5(&mut state, &M_T5);
    }

    sbox_full_t5(&mut state);
    mix_dense_t5(&mut state, &M_T5);

    state[0]
}

// =============================================================================
// Public API
// =============================================================================

use crate::error::WhiteProtocolError;
use anchor_lang::prelude::*;

pub type Scalar = [u8; 32];
pub const IS_PLACEHOLDER: bool = false;

use super::field::{is_valid_fr, u64_to_be32, BN254_FR_MODULUS};

#[inline(never)]
fn validate_input(scalar: &Scalar) -> Result<()> {
    if !is_valid_fr(scalar) {
        return Err(WhiteProtocolError::InvalidPublicInputs.into());
    }
    Ok(())
}

/// Poseidon hash of 2 field elements
#[inline(never)]
pub fn poseidon2(a: &Scalar, b: &Scalar) -> Result<Scalar> {
    validate_input(a)?;
    validate_input(b)?;
    let fa = fr_from_be32(a);
    let fb = fr_from_be32(b);
    Ok(fr_to_be32(&poseidon_ex_t3(fa, fb)))
}

/// Poseidon hash of 3 field elements
#[inline(never)]
pub fn poseidon3(a: &Scalar, b: &Scalar, c: &Scalar) -> Result<Scalar> {
    validate_input(a)?;
    validate_input(b)?;
    validate_input(c)?;
    let fa = fr_from_be32(a);
    let fb = fr_from_be32(b);
    let fc = fr_from_be32(c);
    Ok(fr_to_be32(&poseidon_ex_t4(fa, fb, fc)))
}

/// Poseidon hash of 4 field elements
#[inline(never)]
pub fn poseidon4(a: &Scalar, b: &Scalar, c: &Scalar, d: &Scalar) -> Result<Scalar> {
    validate_input(a)?;
    validate_input(b)?;
    validate_input(c)?;
    validate_input(d)?;
    let fa = fr_from_be32(a);
    let fb = fr_from_be32(b);
    let fc = fr_from_be32(c);
    let fd = fr_from_be32(d);
    Ok(fr_to_be32(&poseidon_ex_t5(fa, fb, fc, fd)))
}

// =============================================================================
// Protocol Functions
// =============================================================================

#[inline(never)]
pub fn compute_commitment(
    secret: &Scalar,
    nullifier: &Scalar,
    amount: u64,
    asset_id: &Scalar,
) -> Result<Scalar> {
    let amount_scalar = u64_to_be32(amount);
    poseidon4(secret, nullifier, &amount_scalar, asset_id)
}

#[inline(never)]
pub fn compute_nullifier_hash(
    nullifier: &Scalar,
    secret: &Scalar,
    leaf_index: u32,
) -> Result<Scalar> {
    let inner = poseidon2(nullifier, secret)?;
    let index_scalar = u64_to_be32(leaf_index as u64);
    poseidon2(&inner, &index_scalar)
}

#[inline(never)]
pub fn verify_commitment(
    commitment: &Scalar,
    secret: &Scalar,
    nullifier: &Scalar,
    amount: u64,
    asset_id: &Scalar,
) -> Result<bool> {
    let computed = compute_commitment(secret, nullifier, amount, asset_id)?;
    Ok(computed == *commitment)
}

// =============================================================================
// Legacy Aliases
// =============================================================================

#[inline(never)]
pub fn hash_two_to_one(left: &Scalar, right: &Scalar) -> Result<Scalar> {
    #[cfg(target_os = "solana")]
    {
        let hash = solana_poseidon::hashv(
            solana_poseidon::Parameters::Bn254X5,
            solana_poseidon::Endianness::BigEndian,
            &[left.as_slice(), right.as_slice()],
        )
        .map_err(|_| error!(crate::error::WhiteProtocolError::CryptographyError))?;
        Ok(hash.to_bytes())
    }
    #[cfg(not(target_os = "solana"))]
    {
        poseidon2(left, right)
    }
}

#[inline(never)]
pub fn poseidon_hash_3(a: &Scalar, b: &Scalar, c: &Scalar) -> Result<Scalar> {
    poseidon3(a, b, c)
}

#[inline(never)]
pub fn poseidon_hash_4(a: &Scalar, b: &Scalar, c: &Scalar, d: &Scalar) -> Result<Scalar> {
    poseidon4(a, b, c, d)
}

// =============================================================================
// Helpers
// =============================================================================

#[inline]
pub fn is_zero(scalar: &Scalar) -> bool {
    scalar.iter().all(|&b| b == 0)
}

#[inline]
pub fn u64_to_scalar(value: u64) -> Scalar {
    u64_to_be32(value)
}

#[inline]
pub fn u64_to_scalar_be(value: u64) -> Scalar {
    u64_to_be32(value)
}

#[inline]
pub fn empty_leaf_hash() -> Scalar {
    [0u8; 32]
}

#[inline]
pub fn is_placeholder_implementation() -> bool {
    IS_PLACEHOLDER
}

#[inline]
pub fn is_valid_scalar(scalar: &Scalar) -> bool {
    is_valid_fr(scalar)
}

#[inline]
pub fn is_canonical_fr(scalar: &Scalar) -> bool {
    is_valid_fr(scalar)
}

pub const BN254_SCALAR_MODULUS: [u8; 32] = BN254_FR_MODULUS;

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn scalar_from_u64(v: u64) -> Scalar {
        u64_to_be32(v)
    }

    #[test]
    fn test_not_placeholder() {
        #[inline(never)]
        fn is_placeholder_runtime() -> bool {
            IS_PLACEHOLDER
        }
        assert!(!is_placeholder_runtime());
    }

    #[test]
    fn test_poseidon2_zero_zero() {
        let zero = [0u8; 32];
        let hash = poseidon2(&zero, &zero).unwrap();
        let expected = [
            0x20, 0x98, 0xf5, 0xfb, 0x9e, 0x23, 0x9e, 0xab, 0x3c, 0xea, 0xc3, 0xf2, 0x7b, 0x81,
            0xe4, 0x81, 0xdc, 0x31, 0x24, 0xd5, 0x5f, 0xfe, 0xd5, 0x23, 0xa8, 0x39, 0xee, 0x84,
            0x46, 0xb6, 0x48, 0x64,
        ];
        assert_eq!(hash, expected, "Poseidon2(0,0) mismatch");
    }

    #[test]
    fn test_poseidon2_one_two() {
        let one = scalar_from_u64(1);
        let two = scalar_from_u64(2);
        let hash = poseidon2(&one, &two).unwrap();
        let expected = [
            0x11, 0x5c, 0xc0, 0xf5, 0xe7, 0xd6, 0x90, 0x41, 0x3d, 0xf6, 0x4c, 0x6b, 0x96, 0x62,
            0xe9, 0xcf, 0x2a, 0x36, 0x17, 0xf2, 0x74, 0x32, 0x45, 0x51, 0x9e, 0x19, 0x60, 0x7a,
            0x44, 0x17, 0x18, 0x9a,
        ];
        assert_eq!(hash, expected, "Poseidon2(1,2) mismatch");
    }

    #[test]
    fn test_poseidon3_one_two_three() {
        let one = scalar_from_u64(1);
        let two = scalar_from_u64(2);
        let three = scalar_from_u64(3);
        let hash = poseidon3(&one, &two, &three).unwrap();
        let expected = [
            0x0e, 0x77, 0x32, 0xd8, 0x9e, 0x69, 0x39, 0xc0, 0xff, 0x03, 0xd5, 0xe5, 0x8d, 0xab,
            0x63, 0x02, 0xf3, 0x23, 0x0e, 0x26, 0x9d, 0xc5, 0xb9, 0x68, 0xf7, 0x25, 0xdf, 0x34,
            0xab, 0x36, 0xd7, 0x32,
        ];
        assert_eq!(hash, expected, "Poseidon3(1,2,3) mismatch");
    }

    #[test]
    fn test_poseidon4_one_two_three_four() {
        let one = scalar_from_u64(1);
        let two = scalar_from_u64(2);
        let three = scalar_from_u64(3);
        let four = scalar_from_u64(4);
        let hash = poseidon4(&one, &two, &three, &four).unwrap();
        let expected = [
            0x29, 0x9c, 0x86, 0x7d, 0xb6, 0xc1, 0xfd, 0xd7, 0x9d, 0xce, 0xfa, 0x40, 0xe4, 0x51,
            0x0b, 0x98, 0x37, 0xe6, 0x0e, 0xbb, 0x1c, 0xe0, 0x66, 0x3d, 0xba, 0xa5, 0x25, 0xdf,
            0x65, 0x25, 0x04, 0x65,
        ];
        assert_eq!(hash, expected, "Poseidon4(1,2,3,4) mismatch");
    }

    #[test]
    fn test_poseidon4_zeros() {
        let zero = [0u8; 32];
        let hash = poseidon4(&zero, &zero, &zero, &zero).unwrap();
        let expected = [
            0x05, 0x32, 0xfd, 0x43, 0x6e, 0x19, 0xc7, 0x0e, 0x51, 0x20, 0x96, 0x94, 0xd9, 0xc2,
            0x15, 0x25, 0x09, 0x37, 0x92, 0x1b, 0x8b, 0x79, 0x06, 0x04, 0x88, 0xc1, 0x20, 0x6d,
            0xb7, 0x3e, 0x99, 0x46,
        ];
        assert_eq!(hash, expected, "Poseidon4(0,0,0,0) mismatch");
    }
}
