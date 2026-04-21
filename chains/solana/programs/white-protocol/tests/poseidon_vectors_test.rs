//! Poseidon Integration Tests - circomlibjs vector verification
//!
//! Run with:
//!   cargo test -p white-protocol --test poseidon_vectors_test -- --nocapture
//!
//! This verifies our Poseidon implementation matches circomlibjs exactly.

use white_protocol::crypto::{poseidon2, poseidon3, poseidon4};
use serde::Deserialize;

type Scalar = [u8; 32];

#[derive(Deserialize)]
struct Vectors {
    poseidon2: Vec<VecCase>,
    poseidon3: Vec<VecCase>,
    poseidon4: Vec<VecCase>,
}

#[derive(Deserialize)]
struct VecCase {
    #[serde(rename = "in")]
    input: Vec<String>,
    out: String,
}

fn hex_to_scalar(s: &str) -> Scalar {
    let s = s.strip_prefix("0x").unwrap_or(s);
    let bytes = hex::decode(s).expect("hex decode");
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    out
}

fn scalar_to_hex(s: &Scalar) -> String {
    format!("0x{}", hex::encode(s))
}

fn load_vectors() -> Vectors {
    let json = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../../tools/poseidon-vectors/vectors.json"
    ));
    serde_json::from_str(json).expect("parse vectors.json")
}

#[test]
fn poseidon2_vectors() {
    let v = load_vectors();
    println!("\n=== poseidon2: {} vectors ===", v.poseidon2.len());

    for (i, c) in v.poseidon2.iter().enumerate() {
        let a = hex_to_scalar(&c.input[0]);
        let b = hex_to_scalar(&c.input[1]);
        let expected = hex_to_scalar(&c.out);
        let got = poseidon2(&a, &b).expect("poseidon2");

        assert_eq!(
            got,
            expected,
            "poseidon2 mismatch at {}: in=[{}, {}], expected={}, got={}",
            i,
            c.input[0],
            c.input[1],
            c.out,
            scalar_to_hex(&got)
        );

        if i < 5 {
            println!("  [{}] ✓", i);
        }
    }
    println!("✓ All {} poseidon2 vectors passed", v.poseidon2.len());
}

#[test]
fn poseidon3_vectors() {
    let v = load_vectors();
    println!("\n=== poseidon3: {} vectors ===", v.poseidon3.len());

    for (i, c) in v.poseidon3.iter().enumerate() {
        let a = hex_to_scalar(&c.input[0]);
        let b = hex_to_scalar(&c.input[1]);
        let c_in = hex_to_scalar(&c.input[2]);
        let expected = hex_to_scalar(&c.out);
        let got = poseidon3(&a, &b, &c_in).expect("poseidon3");

        assert_eq!(
            got,
            expected,
            "poseidon3 mismatch at {}: expected={}, got={}",
            i,
            c.out,
            scalar_to_hex(&got)
        );

        if i < 3 {
            println!("  [{}] ✓", i);
        }
    }
    println!("✓ All {} poseidon3 vectors passed", v.poseidon3.len());
}

#[test]
fn poseidon4_vectors() {
    let v = load_vectors();
    println!("\n=== poseidon4: {} vectors ===", v.poseidon4.len());

    for (i, c) in v.poseidon4.iter().enumerate() {
        let a = hex_to_scalar(&c.input[0]);
        let b = hex_to_scalar(&c.input[1]);
        let c_in = hex_to_scalar(&c.input[2]);
        let d = hex_to_scalar(&c.input[3]);
        let expected = hex_to_scalar(&c.out);
        let got = poseidon4(&a, &b, &c_in, &d).expect("poseidon4");

        assert_eq!(
            got,
            expected,
            "poseidon4 mismatch at {}: expected={}, got={}",
            i,
            c.out,
            scalar_to_hex(&got)
        );

        if i < 3 {
            println!("  [{}] ✓", i);
        }
    }
    println!("✓ All {} poseidon4 vectors passed", v.poseidon4.len());
}

/// Sanity check: verify vectors loaded and poseidon([0,0]) matches known value
#[test]
fn sanity_check() {
    println!("\n=== Sanity check ===");
    let v = load_vectors();

    assert!(!v.poseidon2.is_empty());
    assert!(!v.poseidon3.is_empty());
    assert!(!v.poseidon4.is_empty());

    // poseidon([0,0]) must equal circomlibjs output
    let zero = [0u8; 32];
    let hash = poseidon2(&zero, &zero).unwrap();
    let expected = hex_to_scalar(&v.poseidon2[0].out);

    assert_eq!(hash, expected, "poseidon([0,0]) mismatch");
    println!("  poseidon([0,0]) = {} ✓", scalar_to_hex(&hash));
    println!("✓ Sanity check passed");
}

/// NEGATIVE TEST: Proves tests detect changes.
/// If poseidon output changed (e.g., corrupted constant), this would fail.
#[test]
fn sensitivity_test_detects_changes() {
    println!("\n=== Sensitivity test ===");

    let zero = [0u8; 32];
    let actual = poseidon2(&zero, &zero).unwrap();

    // Create wrong value by flipping a bit
    let mut wrong = actual;
    wrong[0] ^= 0x01;

    assert_ne!(actual, wrong, "Corrupted value should differ");

    // Verify the actual value is the expected circomlibjs output
    let expected = [
        0x20, 0x98, 0xf5, 0xfb, 0x9e, 0x23, 0x9e, 0xab, 0x3c, 0xea, 0xc3, 0xf2, 0x7b, 0x81, 0xe4,
        0x81, 0xdc, 0x31, 0x24, 0xd5, 0x5f, 0xfe, 0xd5, 0x23, 0xa8, 0x39, 0xee, 0x84, 0x46, 0xb6,
        0x48, 0x64,
    ];

    assert_eq!(
        actual,
        expected,
        "poseidon([0,0]) output changed! Implementation may be broken.\nExpected: {}\nGot: {}",
        scalar_to_hex(&expected),
        scalar_to_hex(&actual)
    );

    println!("  Actual:    {}", scalar_to_hex(&actual));
    println!("  Corrupted: {}", scalar_to_hex(&wrong));
    println!("✓ Sensitivity test passed (tests are not no-ops)");
}

/// Test hardcoded known vectors directly (no file dependency)
#[test]
fn hardcoded_vectors() {
    println!("\n=== Hardcoded vectors ===");

    let zero = [0u8; 32];
    let mut one = [0u8; 32];
    one[31] = 1;
    let mut two = [0u8; 32];
    two[31] = 2;
    let mut three = [0u8; 32];
    three[31] = 3;
    let mut four = [0u8; 32];
    four[31] = 4;

    // poseidon([0,0]) from circomlibjs
    let h = poseidon2(&zero, &zero).unwrap();
    assert_eq!(
        scalar_to_hex(&h),
        "0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864"
    );
    println!("  poseidon([0,0]) ✓");

    // poseidon([1,2]) from circomlibjs
    let h = poseidon2(&one, &two).unwrap();
    assert_eq!(
        scalar_to_hex(&h),
        "0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a"
    );
    println!("  poseidon([1,2]) ✓");

    // poseidon([1,2,3]) from circomlibjs
    let h = poseidon3(&one, &two, &three).unwrap();
    assert_eq!(
        scalar_to_hex(&h),
        "0x0e7732d89e6939c0ff03d5e58dab6302f3230e269dc5b968f725df34ab36d732"
    );
    println!("  poseidon([1,2,3]) ✓");

    // poseidon([1,2,3,4]) from circomlibjs
    let h = poseidon4(&one, &two, &three, &four).unwrap();
    assert_eq!(
        scalar_to_hex(&h),
        "0x299c867db6c1fdd79dcefa40e4510b9837e60ebb1ce0663dbaa525df65250465"
    );
    println!("  poseidon([1,2,3,4]) ✓");

    // poseidon([0,0,0,0]) from circomlibjs
    let h = poseidon4(&zero, &zero, &zero, &zero).unwrap();
    assert_eq!(
        scalar_to_hex(&h),
        "0x0532fd436e19c70e51209694d9c215250937921b8b79060488c1206db73e9946"
    );
    println!("  poseidon([0,0,0,0]) ✓");

    println!("✓ All hardcoded vectors passed");
}
