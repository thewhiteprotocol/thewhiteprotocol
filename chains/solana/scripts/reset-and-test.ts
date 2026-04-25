/**
 * Reset merkle tree, then test settlement with fixed proof serialization + fresh VK
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Reset Merkle Tree + Test Settlement");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Step 1: Reset merkle tree
  console.log("🚀 Step 1: Resetting merkle tree...");
  try {
    const txReset = await (program.methods as any)
      .resetMerkleTree()
      .accounts({
        authority,
        poolConfig: POOL_CONFIG,
        merkleTree: merkleTreePda,
      })
      .rpc();
    console.log("✅ Merkle tree reset:", txReset);
  } catch (e: any) {
    console.error("❌ Reset failed:", e.message);
    process.exit(1);
  }

  // Step 2: Check pending buffer
  const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
  console.log("\nPending deposits:", pendingBuffer.deposits.length);
  if (pendingBuffer.deposits.length === 0) {
    console.log("No pending deposits to settle.");
    return;
  }

  // Step 3: Generate batch proof
  console.log("\n🚀 Step 2: Generating batch proof...");

  const snarkjs = await import("snarkjs");
  const { buildPoseidon } = await import("circomlibjs");
  const poseidon = await buildPoseidon();

  const hash2 = (a: bigint, b: bigint): bigint => {
    const result = poseidon([a, b]);
    return BigInt(poseidon.F.toString(result));
  };

  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= 20; i++) {
    zeros.push(hash2(zeros[i - 1], zeros[i - 1]));
  }

  const oldRoot = zeros[20];
  const startIndex = 0;
  const commitment = BigInt('0x' + Buffer.from(pendingBuffer.deposits[0].commitment).toString('hex'));

  // Compute path elements for empty tree at index 0
  const pathElements: string[] = [];
  for (let level = 0; level < 20; level++) {
    pathElements.push(zeros[level].toString());
  }

  // Compute new root
  let newRoot = commitment;
  for (let level = 0; level < 20; level++) {
    newRoot = hash2(newRoot, zeros[level]);
  }

  // Compute commitments hash
  const buffer = Buffer.alloc(32, 0);
  const commitmentBytes = Buffer.from(commitment.toString(16).padStart(64, '0'), 'hex');
  commitmentBytes.copy(buffer, 0);
  const hash = require('crypto').createHash('sha256').update(buffer).digest();
  hash[0] &= 0x1F;
  const commitmentsHash = BigInt('0x' + hash.toString('hex'));

  const circuitInput = {
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    startIndex: startIndex.toString(),
    batchSize: 1,
    commitmentsHash: commitmentsHash.toString(),
    commitments: [commitment.toString()],
    pathElements: [pathElements],
  };

  const circuitDir = path.join(__dirname, '../../../circuits/merkle_batch_update/build');
  const wasmPath = path.join(circuitDir, 'merkle_batch_update_js/merkle_batch_update.wasm');
  const zkeyPath = path.join(circuitDir, 'merkle_batch_update.zkey');

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    circuitInput,
    wasmPath,
    zkeyPath
  );

  console.log("✅ Proof generated");
  console.log("  Public signals:", publicSignals.length);

  // Verify locally
  const vkey = JSON.parse(fs.readFileSync(path.join(circuitDir, 'verification_key.json'), 'utf8'));
  const isValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log("  Local verification:", isValid ? "✅ VALID" : "❌ INVALID");

  if (!isValid) {
    console.error("Local proof verification failed!");
    process.exit(1);
  }

  // Format proof for Anchor — RAW conversion, no modular reduction
  const proofBytes = Buffer.alloc(256);
  const toHex32 = (val: string) => BigInt(val).toString(16).padStart(64, '0');
  let offset = 0;

  proofBytes.write(toHex32(proof.pi_a[0]), offset, 32, 'hex'); offset += 32;
  proofBytes.write(toHex32(proof.pi_a[1]), offset, 32, 'hex'); offset += 32;
  proofBytes.write(toHex32(proof.pi_b[0][1]), offset, 32, 'hex'); offset += 32;
  proofBytes.write(toHex32(proof.pi_b[0][0]), offset, 32, 'hex'); offset += 32;
  proofBytes.write(toHex32(proof.pi_b[1][1]), offset, 32, 'hex'); offset += 32;
  proofBytes.write(toHex32(proof.pi_b[1][0]), offset, 32, 'hex'); offset += 32;
  proofBytes.write(toHex32(proof.pi_c[0]), offset, 32, 'hex'); offset += 32;
  proofBytes.write(toHex32(proof.pi_c[1]), offset, 32, 'hex');

  const newRootBytes: number[] = [];
  const newRootHex = newRoot.toString(16).padStart(64, '0');
  for (let i = 0; i < 64; i += 2) {
    newRootBytes.push(parseInt(newRootHex.substring(i, i + 2), 16));
  }

  // Step 4: Submit settlement
  console.log("\n🚀 Step 3: Submitting settle_deposits_batch...");
  try {
    const tx = await program.methods
      .settleDepositsBatch({
        proof: Array.from(proofBytes),
        newRoot: newRootBytes,
        batchSize: 1,
      })
      .accounts({
        authority,
        poolConfig: POOL_CONFIG,
        merkleTree: merkleTreePda,
        pendingBuffer: pendingBufferPda,
        verificationKey: vkPda,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ])
      .rpc({ commitment: "confirmed" });

    console.log("\n✅✅✅ SETTLEMENT SUCCESSFUL! ✅✅✅");
    console.log("  Transaction:", tx);
    console.log("  Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");

    // Fetch updated state
    const merkleAfter = await (program.account as any).merkleTree.fetch(merkleTreePda);
    const pendingAfter = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
    console.log("\nUpdated state:");
    console.log("  Next leaf index:", merkleAfter.nextLeafIndex);
    console.log("  Pending deposits:", pendingAfter.deposits.length);

  } catch (error: any) {
    console.error("\n❌ Settlement failed:", error.message);
    if (error.logs) {
      const relevant = error.logs.filter((log: string) =>
        log.includes('Error') || log.includes('failed') || log.includes('proof')
      );
      relevant.forEach((log: string) => console.error("  ", log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
