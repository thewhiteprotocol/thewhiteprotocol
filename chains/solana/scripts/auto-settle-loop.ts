/**
 * Auto-Settle Loop for Devnet Testing
 *
 * Continuously monitors the pending deposits buffer and settles
 * batches using `batch_process_deposits` (direct on-chain insertion).
 *
 * This is the WORKING fallback while `settle_deposits_batch` (ZK path)
 * is being debugged.
 *
 * Usage:
 *   export ANCHOR_PROVIDER_URL="https://api.devnet.solana.com"
 *   export ANCHOR_WALLET="$HOME/.config/solana/id.json"
 *   npx tsx scripts/auto-settle-loop.ts
 *
 * Press Ctrl+C to stop.
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, ComputeBudgetProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey(process.env.POOL_CONFIG || "EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const POLL_INTERVAL_MS = 30_000; // Check every 30 seconds
const BATCH_SIZE = 5; // Safe CU limit

async function main() {
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

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Auto-Settle Loop (Direct batch_process_deposits)");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("Pool Config:", POOL_CONFIG.toBase58());
  console.log("Authority:   ", provider.wallet.publicKey.toBase58());
  console.log("Interval:    ", `${POLL_INTERVAL_MS / 1000}s`);
  console.log("Batch Size:  ", BATCH_SIZE);
  console.log("");

  let running = true;
  process.on("SIGINT", () => {
    console.log("\n🛑 Stopping auto-settle loop...");
    running = false;
  });

  while (running) {
    try {
      const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
      const pendingCount = pendingBuffer.deposits.length;

      if (pendingCount === 0) {
        process.stdout.write(`\r[${new Date().toISOString()}] Pending: 0 — waiting...`);
      } else {
        console.log(`\n[${new Date().toISOString()}] Pending: ${pendingCount} — settling...`);
        const toSettle = Math.min(pendingCount, BATCH_SIZE);

        const tx = await (program.methods as any)
          .batchProcessDeposits(toSettle)
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

        const after = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
        const tree = await (program.account as any).merkleTree.fetch(merkleTreePda);
        console.log(`  ✅ Settled ${toSettle} deposit(s) — tx: ${tx.slice(0, 40)}...`);
        console.log(`  Pending: ${after.deposits.length} | Leaf index: ${tree.nextLeafIndex}`);
      }
    } catch (err: any) {
      console.error(`\n  ❌ Error: ${err.message || err}`);
    }

    // Wait for next poll
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
