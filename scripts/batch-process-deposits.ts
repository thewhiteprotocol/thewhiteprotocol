/**
 * Batch Process Deposits - Settle pending commitments into Merkle tree
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const MERKLE_TREE = new PublicKey("2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const batcher = provider.wallet.publicKey;

  // Derive pending buffer PDA
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Batch Processing Deposits");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Batcher:", batcher.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());
  console.log("Merkle Tree:", MERKLE_TREE.toString());
  console.log("Pending Buffer:", pendingBuffer.toString());

  // Process batch with max CUs
  console.log("\n🚀 Processing batch (max 1 deposit, max CUs)...");
  try {
    const tx = await (program.methods as any)
      .batchProcessDeposits(1) // Process just 1 to minimize CUs
      .accounts({
        batcher: batcher,
        poolConfig: POOL_CONFIG,
        merkleTree: MERKLE_TREE,
        pendingBuffer: pendingBuffer,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([
        ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
      ])
      .rpc({ commitment: 'confirmed' });
    
    console.log("\n✅ Batch processed!");
    console.log("Tx:", tx);
    console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (e: any) {
    console.error("\n❌ Error:", e.message);
    if (e.logs) console.error("Logs:", e.logs.slice(-5));
  }
}

main().catch(console.error);
