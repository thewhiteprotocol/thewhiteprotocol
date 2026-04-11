/**
 * Production Pool Initialization - With Explicit Signer
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const HELIUS_RPC = "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343";
const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const TREE_DEPTH = 20;

async function main() {
  console.log("🚀 Initializing Fresh Production Pool\n");

  const connection = new anchor.web3.Connection(HELIUS_RPC, "confirmed");
  
  // Load keypair from file
  const keypairFile = fs.readFileSync(process.env.ANCHOR_WALLET!, "utf-8");
  const keypairData = JSON.parse(keypairFile);
  const authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  const wallet = new anchor.Wallet(authorityKeypair);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  
  anchor.setProvider(provider);

  console.log("✓ Connected to Helius Devnet RPC");
  console.log("✓ Authority:", authorityKeypair.publicKey.toString());
  console.log("");

  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/white_protocol.json"), "utf8")
  );
  
  const program = new Program(idl, PROGRAM_ID, provider);

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

  console.log("📋 New Pool Configuration:");
  console.log("   Pool Config:", poolConfig.toString());
  console.log("   Merkle Tree:", merkleTree.toString());
  console.log("   Pending Buffer:", pendingBuffer.toString());
  console.log("");

  // Check if exists
  try {
    await program.account.poolConfigV2.fetch(poolConfig);
    console.log("⚠️  Pool already exists!");
    return;
  } catch (e) {
    console.log("✓ Pool address is available");
  }

  console.log("\n🔧 Step 1: Initializing pool + merkle tree...");

  try {
    const tx1 = await program.methods
      .initializePoolV2(TREE_DEPTH)
      .accounts({
        authority: authorityKeypair.publicKey,
        poolConfig: poolConfig,
        merkleTree: merkleTree,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("✅ Pool initialized!");
    console.log("   TX:", `https://explorer.solana.com/tx/${tx1}?cluster=devnet`);
    
    console.log("\n🔧 Step 2: Initializing pending buffer...");
    
    const tx2 = await program.methods
      .initializePendingDepositsBuffer()
      .accounts({
        authority: authorityKeypair.publicKey,
        poolConfig: poolConfig,
        pendingBuffer: pendingBuffer,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorityKeypair])
      .rpc();

    console.log("✅ Pending buffer initialized!");
    console.log("   TX:", `https://explorer.solana.com/tx/${tx2}?cluster=devnet`);
    console.log("");

    // Save config
    const config = {
      deployment: "production-fresh",
      network: "devnet",
      rpc: HELIUS_RPC,
      programId: PROGRAM_ID.toString(),
      poolConfig: poolConfig.toString(),
      merkleTree: merkleTree.toString(),
      pendingBuffer: pendingBuffer.toString(),
      authority: authorityKeypair.publicKey.toString(),
      treeDepth: TREE_DEPTH,
      timestamp: new Date().toISOString(),
    };

    const configPath = path.join(__dirname, "../pool-config-fresh.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

    console.log("💾 Configuration saved to pool-config-fresh.json");
    console.log("");
    console.log("🎯 Next: Update Replit frontend config.ts with new addresses");

  } catch (error: any) {
    console.error("\n❌ Failed:", error.message);
    if (error.logs) {
      console.log("\nProgram logs:");
      error.logs.forEach((log: string) => console.log("  ", log));
    }
  }
}

main().catch(console.error);
