/**
 * Test script for generating Merkle batch update proofs
 * Uses REAL on-chain state for the proof inputs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIELD_PRIME = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

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
    console.log("=== Generating Merkle Batch Update Proof ===\n");
    
    // Setup Anchor
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);
    
    const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
    const program = new anchor.Program(idl, provider);
    
    // Fetch on-chain state
    const [merkleTreePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
        PROGRAM_ID
    );
    
    const [pendingBufferPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
        PROGRAM_ID
    );
    
    console.log("Fetching on-chain state...");
    const merkleTree = await (program.account as any).merkleTree.fetch(merkleTreePda);
    const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
    
    const oldRoot = BigInt('0x' + Buffer.from(merkleTree.currentRoot).toString('hex'));
    const startIndex = Number(merkleTree.nextLeafIndex);
    
    console.log("On-chain Merkle Tree:");
    console.log("  Current Root:", oldRoot.toString());
    console.log("  Next Leaf Index:", startIndex);
    
    console.log("\nPending Deposits:", pendingBuffer.deposits.length);
    
    if (pendingBuffer.deposits.length === 0) {
        console.error("\n❌ No pending deposits to settle!");
        console.log("Run e2e-01-deposit.ts first to create deposits.");
        process.exit(1);
    }
    
    // Take the first pending deposit
    const batchSize = 1;
    const maxBatch = 1;
    const commitment = BigInt('0x' + Buffer.from(pendingBuffer.deposits[0].commitment).toString('hex'));
    
    console.log("\nUsing commitment:", commitment.toString());
    
    // Load snarkjs and poseidon
    const snarkjs = await import('snarkjs');
    const { buildPoseidon } = await import('circomlibjs');
    const poseidon = await buildPoseidon();
    
    const hash2 = (a: bigint, b: bigint): bigint => {
        const result = poseidon([a, b]);
        return BigInt(poseidon.F.toString(result));
    };
    
    // Compute zero values
    const zeros: bigint[] = [BigInt(0)];
    for (let i = 1; i <= 20; i++) {
        zeros.push(hash2(zeros[i-1], zeros[i-1]));
    }
    
    console.log("Computing path elements and new root from on-chain tree state...");
    
    // Compute commitments hash
    const commitmentsHash = computeCommitmentsHash([commitment], batchSize, maxBatch);
    console.log("Commitments hash:", commitmentsHash.toString());
    
    // Compute correct path elements from on-chain tree state
    // For insertion at startIndex, path element at level i is:
    //   filled_subtrees[i] if bit i of startIndex is 1 (right child)
    //   zeros[i]           if bit i of startIndex is 0 (left child)
    const onChainFilledSubtrees: bigint[] = merkleTree.filledSubtrees.map(
        (b: number[]) => BigInt('0x' + Buffer.from(b).toString('hex'))
    );
    const onChainZeros: bigint[] = merkleTree.zeros.map(
        (b: number[]) => BigInt('0x' + Buffer.from(b).toString('hex'))
    );
    
    function computePathElements(startIdx: number): string[] {
        const path: string[] = [];
        for (let level = 0; level < 20; level++) {
            const isRightChild = ((startIdx >> level) & 1) === 1;
            if (isRightChild) {
                path.push(onChainFilledSubtrees[level].toString());
            } else {
                path.push(onChainZeros[level].toString());
            }
        }
        return path;
    }
    
    // Compute new root by simulating the insertion
    function computeNewRoot(commitment: bigint, startIdx: number): bigint {
        let current = commitment;
        for (let level = 0; level < 20; level++) {
            const isRightChild = ((startIdx >> level) & 1) === 1;
            const sibling = isRightChild ? onChainFilledSubtrees[level] : onChainZeros[level];
            if (isRightChild) {
                current = hash2(sibling, current);
            } else {
                current = hash2(current, sibling);
            }
        }
        return current;
    }
    
    const pathElements: string[][] = [];
    for (let i = 0; i < maxBatch; i++) {
        pathElements.push(computePathElements(startIndex + i));
    }
    
    // Compute new root using actual tree state
    let newRoot = commitment;
    for (let i = 0; i < batchSize; i++) {
        newRoot = computeNewRoot(commitment, startIndex + i);
    }
    
    // Build input for snarkjs - MUST match circuit public inputs
    const input = {
        oldRoot: oldRoot.toString(),
        newRoot: newRoot.toString(),
        startIndex: startIndex,
        batchSize: batchSize,
        commitmentsHash: commitmentsHash.toString(),
        commitments: [commitment.toString()],
        pathElements: pathElements
    };
    
    console.log("\nCircuit Inputs:");
    console.log("  oldRoot:", input.oldRoot);
    console.log("  newRoot:", input.newRoot);
    console.log("  startIndex:", input.startIndex);
    console.log("  batchSize:", input.batchSize);
    console.log("  commitmentsHash:", input.commitmentsHash);
    
    const circuitDir = path.join(__dirname, '../circuits/build/merkle_batch_update');
    const wasmPath = path.join(circuitDir, 'merkle_batch_update_js/merkle_batch_update.wasm');
    const zkeyPath = path.join(circuitDir, 'merkle_batch_update.zkey');
    const vkeyPath = path.join(circuitDir, 'verification_key.json');
    
    console.log("\nChecking circuit files...");
    console.log("  WASM:", fs.existsSync(wasmPath) ? "✓" : "✗");
    console.log("  ZKEY:", fs.existsSync(zkeyPath) ? "✓" : "✗");
    console.log("  VK:", fs.existsSync(vkeyPath) ? "✓" : "✗");
    
    if (!fs.existsSync(wasmPath) || !fs.existsSync(zkeyPath)) {
        console.error("Missing required files!");
        process.exit(1);
    }
    
    console.log("\nGenerating proof...");
    
    try {
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            input,
            wasmPath,
            zkeyPath
        );
        
        console.log("\n✓ Proof generated successfully!");
        console.log("\nPublic Signals:");
        publicSignals.forEach((s: string, i: number) => {
            console.log(`  [${i}] ${s}`);
        });
        
        // Verify the proof locally
        const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
        const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
        
        console.log("\nLocal verification:", isValid ? "✓ VALID" : "✗ INVALID");
        
        if (!isValid) {
            console.error("Proof verification failed!");
            process.exit(1);
        }
        
        // Format proof for Anchor - SDK-compatible format
        const proofBytes = formatProofForAnchor(proof);
        console.log("\nProof formatted for Anchor (256 bytes):");
        console.log("  First 32 bytes (pi_a x):", proofBytes.slice(0, 32).toString('hex').substring(0, 50) + "...");
        console.log("  Bytes 64-96 (pi_b x_c1):", proofBytes.slice(64, 96).toString('hex').substring(0, 50) + "...");
        
        // Save proof for use in tests
        const outputDir = path.join(__dirname, '../test-proofs');
        fs.mkdirSync(outputDir, { recursive: true });
        fs.writeFileSync(
            path.join(outputDir, 'batch_proof.json'),
            JSON.stringify({ 
                proof, 
                publicSignals, 
                input: {
                    oldRoot: input.oldRoot,
                    newRoot: input.newRoot,
                    startIndex: input.startIndex,
                    batchSize: input.batchSize,
                    commitmentsHash: input.commitmentsHash
                }
            }, null, 2)
        );
        console.log("\n✓ Proof saved to test-proofs/batch_proof.json");
        
        return { proof, publicSignals, proofBytes, commitmentsHash, oldRoot, newRoot };
        
    } catch (error) {
        console.error("\n✗ Proof generation failed:", error);
        throw error;
    }
}

/**
 * Format proof for Anchor - SDK-compatible format
 * Layout (256 bytes):
 * - pi_a: x (32 bytes), y (32 bytes) at offset 0
 * - pi_b: [0][1] (32), [0][0] (32), [1][1] (32), [1][0] (32) at offset 64
 * - pi_c: x (32 bytes), y (32 bytes) at offset 192
 */
function formatProofForAnchor(proof: any): Buffer {
    const buf = Buffer.alloc(256);
    let offset = 0;
    
    const toHex32 = (val: string) => BigInt(val).toString(16).padStart(64, '0');
    
    // pi_a (G1 point) - 64 bytes: x, y
    buf.write(toHex32(proof.pi_a[0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_a[1]), offset, 32, 'hex');
    offset += 32;
    
    // pi_b (G2 point) - 128 bytes: [0][1], [0][0], [1][1], [1][0]
    // Matches SDK serializeProof format
    buf.write(toHex32(proof.pi_b[0][1]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[0][0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[1][1]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_b[1][0]), offset, 32, 'hex');
    offset += 32;
    
    // pi_c (G1 point) - 64 bytes: x, y
    buf.write(toHex32(proof.pi_c[0]), offset, 32, 'hex');
    offset += 32;
    buf.write(toHex32(proof.pi_c[1]), offset, 32, 'hex');
    
    return buf;
}

generateBatchProof().catch(console.error);
