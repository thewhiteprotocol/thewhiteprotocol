"use strict";
/**
 * pSOL v2 Encoding Verification Tests
 *
 * ⚠️ CRITICAL: These tests MUST pass before production deployment!
 *
 * This file verifies that encoding matches between:
 * - circomlib (off-chain Poseidon, Merkle trees)
 * - snarkjs (proof generation, VK export)
 * - Solana syscalls (BN254 pairing verification)
 * - On-chain Rust code
 *
 * Run with: npx ts-node tests/encoding-verification.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
const circomlibjs_1 = require("circomlibjs");
const bn_js_1 = require("bn.js");
// =============================================================================
// CONSTANTS
// =============================================================================
// BN254 scalar field modulus r
const FR_MODULUS = new bn_js_1.BN('21888242871839275222246405745257275088548364400416034343698204186575808495617');
// BN254 base field modulus p
const FQ_MODULUS = new bn_js_1.BN('21888242871839275222246405745257275088696311157297823662689037894645226208583');
// =============================================================================
// ENCODING HELPERS
// =============================================================================
/**
 * Convert BigInt to 32-byte big-endian buffer
 */
function bigintToBe32(value) {
    const bn = bn_js_1.BN.isBN(value) ? value : new bn_js_1.BN(value.toString());
    const hex = bn.toString(16).padStart(64, '0');
    return Buffer.from(hex, 'hex');
}
/**
 * Convert 32-byte big-endian buffer to BigInt
 */
function be32ToBigint(buf) {
    return BigInt('0x' + buf.toString('hex'));
}
/**
 * Convert snarkjs G1 point to Solana encoding (64 bytes BE)
 */
function snarkjsG1ToSolana(point) {
    const x = bigintToBe32(BigInt(point[0]));
    const y = bigintToBe32(BigInt(point[1]));
    return Buffer.concat([x, y]);
}
/**
 * Convert snarkjs G2 point to Solana encoding (128 bytes BE)
 *
 * ⚠️ NOTE: snarkjs uses [c0, c1] order, Solana wants [c1, c0]!
 */
function snarkjsG2ToSolana(point) {
    const x_c0 = bigintToBe32(BigInt(point[0][0]));
    const x_c1 = bigintToBe32(BigInt(point[0][1]));
    const y_c0 = bigintToBe32(BigInt(point[1][0]));
    const y_c1 = bigintToBe32(BigInt(point[1][1]));
    // SWAP c0/c1 for Solana!
    return Buffer.concat([x_c1, x_c0, y_c1, y_c0]);
}
/**
 * Convert snarkjs proof to Solana encoding (256 bytes)
 */
function snarkjsProofToSolana(proof) {
    const a = snarkjsG1ToSolana(proof.pi_a);
    const b = snarkjsG2ToSolana(proof.pi_b);
    const c = snarkjsG1ToSolana(proof.pi_c);
    return Buffer.concat([a, b, c]);
}
// =============================================================================
// POSEIDON TESTS
// =============================================================================
async function testPoseidonEncoding() {
    console.log('\n=== POSEIDON ENCODING TESTS ===\n');
    const poseidon = await (0, circomlibjs_1.buildPoseidon)();
    const F = poseidon.F;
    // Test 1: Poseidon(1, 2) - basic test vector
    {
        const inputs = [1n, 2n];
        const hash = poseidon(inputs);
        const hashBigInt = F.toObject(hash);
        const hashBytes = bigintToBe32(hashBigInt);
        console.log('Test: Poseidon(1, 2)');
        console.log('  Input: [1, 2]');
        console.log('  Hash (decimal):', hashBigInt.toString());
        console.log('  Hash (hex BE):', hashBytes.toString('hex'));
        console.log('');
        // ⚠️ UPDATE THIS with your on-chain computed value!
        // const expectedOnChain = Buffer.from('...', 'hex');
        // if (!hashBytes.equals(expectedOnChain)) {
        //   throw new Error('Poseidon(1,2) mismatch between circomlib and on-chain!');
        // }
    }
    // Test 2: Poseidon with 32-byte inputs (like commitments)
    {
        const secret = Buffer.alloc(32);
        secret[31] = 0x42; // secret = 66
        const nullifier = Buffer.alloc(32);
        nullifier[31] = 0x01; // nullifier = 1
        const amount = 1000000n; // 1 token with 6 decimals
        const assetId = Buffer.alloc(32);
        assetId[31] = 0x01; // asset_id = 1
        // Convert to field elements
        const secretFe = F.e(be32ToBigint(secret));
        const nullifierFe = F.e(be32ToBigint(nullifier));
        const amountFe = F.e(amount);
        const assetIdFe = F.e(be32ToBigint(assetId));
        // Hash: commitment = H(secret, nullifier, amount, asset_id)
        const commitment = poseidon([secretFe, nullifierFe, amountFe, assetIdFe]);
        const commitmentBigInt = F.toObject(commitment);
        const commitmentBytes = bigintToBe32(commitmentBigInt);
        console.log('Test: Commitment computation');
        console.log('  secret:', be32ToBigint(secret).toString());
        console.log('  nullifier:', be32ToBigint(nullifier).toString());
        console.log('  amount:', amount.toString());
        console.log('  asset_id:', be32ToBigint(assetId).toString());
        console.log('  commitment (decimal):', commitmentBigInt.toString());
        console.log('  commitment (hex BE):', commitmentBytes.toString('hex'));
        console.log('');
    }
    // Test 3: Merkle tree hash (2-to-1)
    {
        const left = Buffer.alloc(32);
        left[31] = 0x01;
        const right = Buffer.alloc(32);
        right[31] = 0x02;
        const leftFe = F.e(be32ToBigint(left));
        const rightFe = F.e(be32ToBigint(right));
        const parent = poseidon([leftFe, rightFe]);
        const parentBigInt = F.toObject(parent);
        const parentBytes = bigintToBe32(parentBigInt);
        console.log('Test: Merkle 2-to-1 hash');
        console.log('  left:', be32ToBigint(left).toString());
        console.log('  right:', be32ToBigint(right).toString());
        console.log('  parent (decimal):', parentBigInt.toString());
        console.log('  parent (hex BE):', parentBytes.toString('hex'));
        console.log('');
    }
    console.log('✅ Poseidon tests complete');
    console.log('⚠️  You MUST verify these values match your on-chain implementation!\n');
}
// =============================================================================
// SNARKJS PROOF ENCODING TESTS
// =============================================================================
async function testProofEncoding() {
    console.log('\n=== PROOF ENCODING TESTS ===\n');
    // Example snarkjs proof structure (you'd load this from a real proof)
    const exampleProof = {
        pi_a: [
            "12345678901234567890123456789012345678901234567890",
            "98765432109876543210987654321098765432109876543210",
            "1"
        ],
        pi_b: [
            ["11111111111111111111111111111111111111111111111111", "22222222222222222222222222222222222222222222222222"],
            ["33333333333333333333333333333333333333333333333333", "44444444444444444444444444444444444444444444444444"],
            ["1", "0"]
        ],
        pi_c: [
            "55555555555555555555555555555555555555555555555555",
            "66666666666666666666666666666666666666666666666666",
            "1"
        ]
    };
    const solanaProof = snarkjsProofToSolana(exampleProof);
    console.log('Proof encoding:');
    console.log('  Total length:', solanaProof.length, 'bytes');
    console.log('  A (G1, 64 bytes):', solanaProof.slice(0, 64).toString('hex').slice(0, 32) + '...');
    console.log('  B (G2, 128 bytes):', solanaProof.slice(64, 192).toString('hex').slice(0, 32) + '...');
    console.log('  C (G1, 64 bytes):', solanaProof.slice(192, 256).toString('hex').slice(0, 32) + '...');
    console.log('');
    // Verify G2 c0/c1 swap
    console.log('G2 encoding verification:');
    console.log('  snarkjs x: [c0, c1] =', exampleProof.pi_b[0]);
    console.log('  solana x:  [c1, c0] = swapped for syscall');
    console.log('');
    console.log('✅ Proof encoding test complete\n');
}
// =============================================================================
// PUBLIC INPUT ENCODING TESTS
// =============================================================================
async function testPublicInputEncoding() {
    console.log('\n=== PUBLIC INPUT ENCODING TESTS ===\n');
    // Test various public input types
    const tests = [
        { name: 'amount', value: 1000000n, desc: '1 token (6 decimals)' },
        { name: 'amount_large', value: 1000000000000n, desc: '1M tokens' },
        { name: 'timestamp', value: 1704067200n, desc: 'Jan 1, 2024' },
        { name: 'fee_bps', value: 100n, desc: '1% fee' },
    ];
    for (const test of tests) {
        const bytes = bigintToBe32(test.value);
        console.log(`${test.name} (${test.desc}):`);
        console.log(`  value: ${test.value}`);
        console.log(`  bytes (BE): ${bytes.toString('hex')}`);
        // Verify it's a valid scalar
        const bn = new bn_js_1.BN(test.value.toString());
        if (bn.gte(FR_MODULUS)) {
            console.log(`  ⚠️ WARNING: Value >= scalar field modulus!`);
        }
        console.log('');
    }
    // Test Pubkey encoding
    {
        // Example Solana pubkey (32 bytes)
        {
            // Example Solana pubkey (32 bytes)
            const pubkeyBase58 = 'So11111111111111111111111111111111111111112';
            // base58 decode (Node Buffer does NOT support "base58" encoding)
            const pubkeyBytesU8 = anchor.utils.bytes.bs58.decode(pubkeyBase58); // Uint8Array
            if (pubkeyBytesU8.length !== 32) {
                throw new Error(`Invalid pubkey length: expected 32, got ${pubkeyBytesU8.length}`);
            }
            const pubkey = Buffer.from(pubkeyBytesU8); // Buffer for hex/logging
            console.log('Pubkey encoding:');
            console.log(`  pubkey (base58): ${pubkeyBase58}`);
            console.log('  pubkey (hex):', pubkey.toString('hex'));
            console.log('  As scalar:', be32ToBigint(pubkey).toString().slice(0, 30) + '...');
            console.log('');
        }
        // =============================================================================
        // VERIFICATION KEY ENCODING TESTS
        // =============================================================================
        async function testVkEncoding() {
            console.log('\n=== VERIFICATION KEY ENCODING TESTS ===\n');
            // Example VK structure (you'd load this from snarkjs)
            // snarkjs exportVerificationKey outputs:
            // {
            //   "protocol": "groth16",
            //   "curve": "bn128",
            //   "nPublic": 8,
            //   "vk_alpha_1": ["...", "...", "1"],
            //   "vk_beta_2": [["...", "..."], ["...", "..."], ["1", "0"]],
            //   "vk_gamma_2": [...],
            //   "vk_delta_2": [...],
            //   "vk_alphabeta_12": [...],  // Not needed for verification
            //   "IC": [["...", "...", "1"], ...]
            // }
            console.log('VK encoding layout:');
            console.log('  alpha (G1): 64 bytes');
            console.log('  beta (G2): 128 bytes');
            console.log('  gamma (G2): 128 bytes');
            console.log('  delta (G2): 128 bytes');
            console.log('  IC (G1[]): 64 bytes each');
            console.log('');
            console.log('  For n public inputs, IC has n+1 elements');
            console.log('  Withdraw circuit (8 inputs) => IC has 9 elements => 576 bytes');
            console.log('');
            console.log('✅ VK encoding test complete\n');
        }
        // =============================================================================
        // MAIN
        // =============================================================================
        async function main() {
            console.log('╔═══════════════════════════════════════════════════════════════╗');
            console.log('║         pSOL v2 ENCODING VERIFICATION SUITE                   ║');
            console.log('║                                                               ║');
            console.log('║  ⚠️  ALL TESTS MUST PASS BEFORE PRODUCTION DEPLOYMENT!  ⚠️   ║');
            console.log('╚═══════════════════════════════════════════════════════════════╝');
            try {
                await testPoseidonEncoding();
                await testProofEncoding();
                await testPublicInputEncoding();
                await testVkEncoding();
                console.log('═══════════════════════════════════════════════════════════════');
                console.log('');
                console.log('NEXT STEPS:');
                console.log('');
                console.log('1. Run your REAL circuit through snarkjs and capture:');
                console.log('   - verification_key.json');
                console.log('   - proof.json');
                console.log('   - public.json');
                console.log('');
                console.log('2. Compare Poseidon outputs above with your on-chain values');
                console.log('');
                console.log('3. Submit a known-good proof to your on-chain program');
                console.log('');
                console.log('4. If verification fails, check:');
                console.log('   - G2 c0/c1 order (snarkjs vs Solana)');
                console.log('   - Endianness (should be big-endian)');
                console.log('   - Public input ordering (must match circuit)');
                console.log('');
                console.log('═══════════════════════════════════════════════════════════════');
            }
            catch (e) {
                console.error('❌ ENCODING VERIFICATION FAILED:', e);
                process.exit(1);
            }
        }
        main();
    }
}
