/**
 * Production Pool Initialization - Manual Transaction
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const TREE_DEPTH = 20;

async function main() {
  console.log("🚀 Production Pool Initialization\n");

  const authorityKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343",
    "confirmed"
  );

  console.log("✓ Authority:", authorityKeypair.publicKey.toString());
  console.log("");

  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/white_protocol.json"), "utf8")
  );

  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const program = new anchor.Program(idl, provider);

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

  console.log("📋 Pool Configuration:");
  console.log("   Pool:", poolConfig.toString());
  console.log("   Merkle:", merkleTree.toString());
  console.log("   Pending:", pendingBuffer.toString());
  console.log("");

  try {
    await program.account.poolConfigV2.fetch(poolConfig);
    console.log("⚠️  Pool exists!");
    return;
  } catch (e) {
    console.log("✓ Available\n");
  }

  console.log("🔧 Building instruction...");

  try {
    // Build instruction manually
    const ix = await program.methods
      .initializePoolV2(TREE_DEPTH)
      .accounts({
        authority: authorityKeypair.publicKey,
        pool_config: poolConfig,
        merkle_tree: merkleTree,
        system_program: SystemProgram.programId,
      })
      .instruction();

    console.log("✓ Instruction built");
    
    // Build and send transaction manually
    const tx = new Transaction().add(ix);
    tx.feePayer = authorityKeypair.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    console.log("📤 Sending transaction...");
    
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [authorityKeypair],
      { commitment: "confirmed" }
    );

    console.log("✅ Pool initialized!");
    console.log("   TX:", `https://explorer.solana.com/tx/${sig}?cluster=devnet\n`);

    console.log("🔧 Initializing pending buffer...");

    const ix2 = await program.methods
      .initializePendingDepositsBuffer()
      .accounts({
        authority: authorityKeypair.publicKey,
        pool_config: poolConfig,
        pending_buffer: pendingBuffer,
        system_program: SystemProgram.programId,
      })
      .instruction();

    const tx2 = new Transaction().add(ix2);
    tx2.feePayer = authorityKeypair.publicKey;
    tx2.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const sig2 = await sendAndConfirmTransaction(
      connection,
      tx2,
      [authorityKeypair],
      { commitment: "confirmed" }
    );

    console.log("✅ Buffer initialized!");
    console.log("   TX:", `https://explorer.solana.com/tx/${sig2}?cluster=devnet\n`);

    console.log("✅ COMPLETE");

  } catch (error: any) {
    console.error("\n❌ Failed:", error.message);
    if (error.logs) {
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }
}

main().catch(console.error);
