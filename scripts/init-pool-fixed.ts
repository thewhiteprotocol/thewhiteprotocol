/**
 * The White Protocol v2 Pool Initialization - Fixed for Anchor 0.32+
 * Uses snake_case account names to match IDL
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const TREE_DEPTH = 20;
const ROOT_HISTORY_SIZE = 100;  // MISSING IN YOUR ORIGINAL SCRIPT!

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("       The White Protocol v2 Pool Initialization (Anchor 0.32+ Fixed)        ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const authorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL!,
    "confirmed"
  );

  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/white_protocol.json"), "utf8")
  );
  const program = new anchor.Program(idl, provider);

  console.log("✓ Authority:", authorityKeypair.publicKey.toString());
  const balance = await connection.getBalance(authorityKeypair.publicKey);
  console.log(`✓ Balance: ${(balance / 1e9).toFixed(4)} SOL\n`);

  // Derive PDAs
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_v2"), authorityKeypair.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree_v2"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_deposits"), poolConfig.toBuffer()],
    PROGRAM_ID
  );

  console.log("📋 PDAs:");
  console.log("   Pool Config:", poolConfig.toString());
  console.log("   Merkle Tree:", merkleTree.toString());
  console.log("   Pending Buffer:", pendingBuffer.toString());
  console.log("");

  // Check if pool exists
  try {
    await program.account.poolConfigV2.fetch(poolConfig);
    console.log("⚠️  Pool already exists! Verifying state...\n");
    await verifyPool(program, poolConfig, merkleTree, pendingBuffer);
    return;
  } catch (e) {
    console.log("✓ Pool address available\n");
  }

  // =========================================================================
  // STEP 1: Initialize Pool + Merkle Tree
  // =========================================================================
  console.log("Step 1: Initializing Pool + Merkle Tree...");

  try {
    // KEY FIX: Use snake_case for account names (matches IDL)
    // KEY FIX: Pass BOTH arguments (tree_depth, root_history_size)
    const ix1 = await program.methods
      .initializePoolV2(TREE_DEPTH, ROOT_HISTORY_SIZE)
      .accounts({
        authority: authorityKeypair.publicKey,
        pool_config: poolConfig,           // snake_case!
        merkle_tree: merkleTree,           // snake_case!
        system_program: SystemProgram.programId,  // snake_case!
      })
      .instruction();

    const tx1 = new Transaction();
    tx1.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    tx1.add(ix1);
    tx1.feePayer = authorityKeypair.publicKey;
    tx1.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const sig1 = await sendAndConfirmTransaction(connection, tx1, [authorityKeypair], {
      commitment: "confirmed",
    });

    console.log("   ✅ Pool + Merkle Tree initialized!");
    console.log(`   TX: https://explorer.solana.com/tx/${sig1}?cluster=devnet\n`);
  } catch (error: any) {
    if (error.message?.includes("already in use")) {
      console.log("   ✓ Already initialized (skipping)\n");
    } else {
      console.error("   ❌ Failed:", error.message);
      if (error.logs) error.logs.forEach((l: string) => console.log("     ", l));
      throw error;
    }
  }

  // =========================================================================
  // STEP 2: Initialize Pending Deposits Buffer
  // =========================================================================
  console.log("Step 2: Initializing Pending Deposits Buffer...");

  // Check if buffer exists
  const bufferInfo = await connection.getAccountInfo(pendingBuffer);
  if (bufferInfo !== null) {
    console.log("   ✓ Buffer already exists (skipping)\n");
  } else {
    try {
      const ix2 = await program.methods
        .initializePendingDepositsBuffer()
        .accounts({
          authority: authorityKeypair.publicKey,
          pool_config: poolConfig,         // snake_case!
          pending_buffer: pendingBuffer,   // snake_case!
          system_program: SystemProgram.programId,
        })
        .instruction();

      const tx2 = new Transaction();
      tx2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
      tx2.add(ix2);
      tx2.feePayer = authorityKeypair.publicKey;
      tx2.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig2 = await sendAndConfirmTransaction(connection, tx2, [authorityKeypair], {
        commitment: "confirmed",
      });

      console.log("   ✅ Pending Buffer initialized!");
      console.log(`   TX: https://explorer.solana.com/tx/${sig2}?cluster=devnet\n`);
    } catch (error: any) {
      if (error.message?.includes("already in use")) {
        console.log("   ✓ Already initialized (skipping)\n");
      } else {
        console.error("   ❌ Failed:", error.message);
        throw error;
      }
    }
  }

  // =========================================================================
  // VERIFICATION
  // =========================================================================
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                      VERIFICATION                             ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  await verifyPool(program, poolConfig, merkleTree, pendingBuffer);

  console.log("\n🎉 Pool initialization complete!\n");
  console.log("Export for other scripts:");
  console.log(`  export POOL_CONFIG=${poolConfig.toString()}`);
  console.log(`  export MERKLE_TREE=${merkleTree.toString()}`);
  console.log(`  export PENDING_BUFFER=${pendingBuffer.toString()}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Upload verification keys (deposit, withdraw, merkle_batch)");
  console.log("  2. Register assets (SOL)");
  console.log("  3. Test deposit → settle → withdraw flow");
}

async function verifyPool(
  program: anchor.Program,
  poolConfig: PublicKey,
  merkleTree: PublicKey,
  pendingBuffer: PublicKey
) {
  try {
    const pool = await program.account.poolConfigV2.fetch(poolConfig);
    console.log("Pool Config: ✅");
    console.log(`  Authority: ${pool.authority}`);
    console.log(`  Merkle Tree: ${pool.merkleTree}`);
    console.log(`  Is Paused: ${pool.isPaused}`);
  } catch (e) {
    console.log("Pool Config: ❌ Not found");
  }

  try {
    const tree = await program.account.merkleTreeV2.fetch(merkleTree);
    console.log("Merkle Tree: ✅");
    console.log(`  Next Leaf Index: ${tree.nextLeafIndex}`);
    console.log(`  Root History Size: ${tree.rootHistorySize}`);
    const rootHex = Buffer.from(tree.currentRoot).toString("hex");
    console.log(`  Current Root: ${rootHex.slice(0, 16)}...`);
  } catch (e) {
    console.log("Merkle Tree: ❌ Not found");
  }

  try {
    const buffer = await program.account.pendingDepositsBuffer.fetch(pendingBuffer);
    console.log("Pending Buffer: ✅");
    console.log(`  Pool: ${buffer.pool}`);
    console.log(`  Total Pending: ${buffer.totalPending}`);
  } catch (e) {
    console.log("Pending Buffer: ❌ Not found");
  }
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err);
  process.exit(1);
});
