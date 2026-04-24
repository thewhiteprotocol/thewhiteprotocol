/**
 * Direct Batch Settlement — Authority-Only Fallback
 *
 * This script calls `batch_process_deposits` directly on-chain.
 * It does NOT require a ZK proof. It performs Poseidon hashing on-chain,
 * which is CU-heavy but functional.
 *
 * Use this when `settle_deposits_batch` (ZK path) is broken or when you
 * need to unblock pending deposits immediately.
 *
 * Usage:
 *   export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
 *   export ANCHOR_WALLET="$HOME/.config/solana/id.json"
 *   npx tsx scripts/batch-settle-direct.ts [max_to_process]
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey(process.env.POOL_CONFIG || "EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
  const maxToProcess = parseInt(process.argv[2] || "5", 10);
  if (maxToProcess < 1 || maxToProcess > 10) {
    console.error("max_to_process must be between 1 and 10 (CU safety limit)");
    process.exit(1);
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(
    require("fs").readFileSync("./target/idl/white_protocol.json", "utf8")
  );
  const program = new Program(idl, provider);

  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
  console.log("Pending deposits:", pendingBuffer.deposits.length);

  if (pendingBuffer.deposits.length === 0) {
    console.log("Nothing to settle.");
    return;
  }

  const actualBatch = Math.min(maxToProcess, pendingBuffer.deposits.length);
  console.log(`Settling ${actualBatch} deposit(s)...`);

  const tx = await (program.methods as any)
    .batchProcessDeposits(actualBatch)
    .accounts({
      batcher: provider.wallet.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: merkleTreePda,
      pendingBuffer: pendingBufferPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
    ])
    .rpc({ commitment: "confirmed" });

  console.log("✅ Batch settled:", tx);

  const pendingAfter = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
  const merkleAfter = await (program.account as any).merkleTree.fetch(merkleTreePda);
  console.log("Pending after:", pendingAfter.deposits.length);
  console.log("Next leaf index:", merkleAfter.nextLeafIndex);
}

main().catch((err) => {
  console.error("❌ Settlement failed:", err);
  process.exit(1);
});
