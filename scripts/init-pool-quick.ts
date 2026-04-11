import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as anchor from "@coral-xyz/anchor";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );
  
  console.log("Authority:", authority.publicKey.toString());
  console.log("Balance:", await connection.getBalance(authority.publicKey) / 1e9, "SOL");

  // Derive PDAs
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_v2"), authority.publicKey.toBuffer()],
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

  console.log("\nPool Addresses:");
  console.log("  Pool Config:", poolConfig.toString());
  console.log("  Merkle Tree:", merkleTree.toString());
  console.log("  Pending Buffer:", pendingBuffer.toString());

  // Check if pool exists
  const poolAccount = await connection.getAccountInfo(poolConfig);
  if (poolAccount) {
    console.log("\n⚠️  Pool already exists!");
    return;
  }

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);

  console.log("\n🔧 Step 1: Initialize Pool + Merkle Tree...");
  
  // Try with accounts() instead of accountsStrict()
  const tx1 = await (program.methods as any)
    .initializePoolV2(20)
    .accounts({
      authority: authority.publicKey,
      poolConfig: poolConfig,
      merkleTree: merkleTree,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  console.log("✅ Pool initialized! TX:", tx1);

  // Wait a bit
  await new Promise(r => setTimeout(r, 2000));

  console.log("\n🔧 Step 2: Initialize Pending Buffer...");
  
  const tx2 = await (program.methods as any)
    .initializePendingDepositsBuffer()
    .accounts({
      authority: authority.publicKey,
      poolConfig: poolConfig,
      pendingBuffer: pendingBuffer,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  console.log("✅ Pending buffer initialized! TX:", tx2);

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                    FRESH POOL READY!");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\n📋 Update Replit sequencer config with these values:\n");
  console.log("  POOL_CONFIG:", poolConfig.toString());
  console.log("  MERKLE_TREE:", merkleTree.toString());
  console.log("  PENDING_BUFFER:", pendingBuffer.toString());
  console.log("");
}

main().catch(console.error);
