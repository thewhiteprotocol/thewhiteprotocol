/**
 * Test script for generating Merkle batch update proofs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Compute commitments hash the same way as the circuit
function computeCommitmentsHash(commitments: bigint[], batchSize: number, maxBatch: number): bigint {
    const bitsBE: number[] = [];
    
    for (let i = 0; i < maxBatch; i++) {
        const isActive = i < batchSize;
        const value = isActive ? commitments[i] : BigInt(0);
        
        for (let j = 255; j >= 0; j--) {
            bitsBE.push(Number((value >> BigInt(j)) & BigInt(1)));
        }
    }
    
    const bytes = Buffer.alloc(bitsBE.length / 8);
    for (let i = 0; i < bitsBE.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8; j++) {
            byte = (byte << 1) | bitsBE[i + j];
        }
        bytes[i / 8] = byte;
    }
    
    const hash = createHash('sha256');
    hash.update(bytes);
    const digest = hash.digest();
    
    const digestBits: number[] = [];
    for (let i = 0; i < digest.length; i++) {
        for (let j = 7; j >= 0; j--) {
            digestBits.push((digest[i] >> j) & 1);
        }
    }
    
    let result = BigInt(0);
    for (let i = 0; i < 253; i++) {
        const bitPos = 255 - i;
        const bit = digestBits[bitPos];
        result = result | (BigInt(bit) << BigInt(i));
    }
    
    return result % FIELD_PRIME;
}

async function generateBatchProof() {
    console.log("=== Testing Merkle Batch Update Proof Generation ===\n");
    
    const snarkjs = await import('snarkjs');
    const { buildPoseidon } = await import('circomlibjs');
    const poseidon = await buildPoseidon();
    
    const hash2 = (a: bigint, b: bigint): bigint => {
        const result = poseidon([a, b]);
        return BigInt(poseidon.F.toString(result));
    };
    
    const circuitDir = path.join(__dirname, '../circuits/build/merkle_batch_update');
    const wasmPath = path.join(circuitDir, 'merkle_batch_update_js/merkle_batch_update.wasm');
    const zkeyPath = path.join(circuitDir, 'merkle_batch_update.zkey');
    const vkeyPath = path.join(circuitDir, 'verification_key.json');
    
    console.log("Checking files...");
    console.log("  WASM:", fs.existsSync(wasmPath) ? "✓" : "✗");
    console.log("  ZKEY:", fs.existsSync(zkeyPath) ? "✓" : "✗");
    console.log("  VK:", fs.existsSync(vkeyPath) ? "✓" : "✗");
    
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        console.error("Missing required files!");
        process.exit(1);
    }
    
    const depth = 20;
    const startIndex = 0;
    const batchSize = 1;
    const maxBatch = 1;
    
    // Generate a test commitment
    const commitment = BigInt("12345678901234567890123456789012345678901234567890123456789012") % FIELD_PRIME;
    
    // Compute oldRoot: root when all leaves are 0
    // Circuit uses: Poseidon(current, pathElement) where pathElement = 0
    let oldRoot = BigInt(0);
    for (let i = 0; i < depth; i++) {
        oldRoot = hash2(oldRoot, BigInt(0));
    }
    
    console.log("  Computed oldRoot:", oldRoot.toString());
    
    // Compute newRoot: root after inserting commitment at startIndex
    // First compute the new leaf path
    let newRoot = commitment;
    for (let i = 0; i < depth; i++) {
        newRoot = hash2(newRoot, BigInt(0));
    }
    
    console.log("  Computed newRoot:", newRoot.toString());
    
    // Compute commitments hash
    const commitments = [commitment];
    const commitmentsHash = computeCommitmentsHash(commitments, batchSize, maxBatch);
    
    console.log("  Commitments hash:", commitmentsHash.toString());
    
    // Path elements - all zeros for an empty tree
    const pathElements: string[][] = [];
    for (let i = 0; i < maxBatch; i++) {
        pathElements.push(Array(depth).fill("0"));
    }
    
    // Build input for snarkjs
    const input = {
        oldRoot: oldRoot.toString(),
        newRoot: newRoot.toString(),
        startIndex: startIndex,
        batchSize: batchSize,
        commitmentsHash: commitmentsHash.toString(),
        commitments: commitments.map(c => c.toString()),
        pathElements: pathElements
    };
    
    console.log("\nGenerating proof...");
    
    try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            wasmPath,
            zkeyPath
        );
        
        console.log("\n✓ Proof generated successfully!");
        console.log("\nPublic Signals:", publicSignals);
        
        // Verify the proof
        const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
        const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
        
        console.log("\nProof verification:", isValid ? "✓ VALID" : "✗ INVALID");
        
        // Format proof for Anchor
        const proofBytes = await formatProofForAnchor(proof);
        console.log("\nProof formatted for Anchor (256 bytes):");
        console.log("  First 64 bytes:", proofBytes.slice(0, 64).toString('hex').substring(0, 50) + "...");
        
        // Save proof for use in tests
        const outputDir = path.join(__dirname, '../test-proofs');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
            path.join(outputDir, 'batch_proof.json'),
            JSON.stringify({ proof, publicSignals, input: {
                oldRoot: input.oldRoot,
                newRoot: input.newRoot,
                startIndex: input.startIndex,
                batchSize: input.batchSize,
                commitmentsHash: input.commitmentsHash
            }}, null, 2)
        );
        console.log("\nProof saved to test-proofs/batch_proof.json");
        
        return { proof, publicSignals, proofBytes, commitmentsHash, oldRoot, newRoot };
        
    } catch (error) {
        console.error("\n✗ Proof generation failed:", error);
        throw error;
    }
}

async function formatProofForAnchor(proof: any): Promise<Buffer> {
    const buf = Buffer.alloc(256);
    let offset = 0;
    
    // pi_a (G1 point) - 64 bytes
    const pi_a = proof.pi_a;
    buf.write(BigInt(pi_a[0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    offset += 32;
    buf.write(BigInt(pi_a[1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    offset += 32;
    
    // pi_b (G2 point) - 128 bytes
    const pi_b = proof.pi_b;
    buf.write(BigInt(pi_b[0][0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    offset += 32;
    buf.write(BigInt(pi_b[0][1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    offset += 32;
    buf.write(BigInt(pi_b[1][0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    offset += 32;
    buf.write(BigInt(pi_b[1][1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    offset += 32;
    
    // pi_c (G1 point) - 64 bytes
    const pi_c = proof.pi_c;
    buf.write(BigInt(pi_c[0]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    offset += 32;
    buf.write(BigInt(pi_c[1]).toString(16).padStart(64, '0'), offset, 32, 'hex');
    
    return buf;
}

generateBatchProof().catch(console.error);
