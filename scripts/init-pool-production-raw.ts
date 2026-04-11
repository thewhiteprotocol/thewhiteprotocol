/**
 * The White Protocol v2 Pool Initialization - Production Grade
 * Uses raw TransactionInstruction to match working scripts pattern
 */
import { 
  Connection, 
  Keypair, 
  PublicKey, 
  SystemProgram, 
  Transaction, 
  sendAndConfirmTransaction,
  TransactionInstruction,
  ComputeBudgetProgram
} from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

// From IDL: initialize_pool_v2 discriminator
const INIT_POOL_DISCRIMINATOR = Buffer.from([207, 45, 87, 242, 27, 63, 204, 67]);

// From IDL: initialize_pending_deposits_buffer discriminator
const INIT_PENDING_DISCRIMINATOR = Buffer.from([84, 154, 177, 23, 77, 17, 70, 47]);

// Pool parameters
const TREE_DEPTH = 20;
const ROOT_HISTORY_SIZE = 100;

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("       The White Protocol v2 Pool Initialization - Production Grade          ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const keypairPath = process.env.ANCHOR_WALLET || "/home/vscode/.config/solana/pool-authority-v5.json";

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8")))
  );
  
  console.log("Authority:", authority.publicKey.toString());
  const balance = await connection.getBalance(authority.publicKey);
  console.log("Balance:", (balance / 1e9).toFixed(4), "SOL\n");

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

  console.log("📋 Pool Addresses:");
  console.log("   Pool Config:    ", poolConfig.toString());
  console.log("   Merkle Tree:    ", merkleTree.toString());
  console.log("   Pending Buffer: ", pendingBuffer.toString());
  console.log("");

  // Check if pool already exists
  const existingPool = await connection.getAccountInfo(poolConfig);
  if (existingPool) {
    console.log("⚠️  Pool already exists at this address!");
    console.log("   Use a different authority wallet for a new pool.\n");
    return;
  }

  // Step 1: Initialize Pool + Merkle Tree
  console.log("🔧 Step 1: Initializing Pool + Merkle Tree...");
  
  // Build instruction data: discriminator (8) + tree_depth (1) + root_history_size (2)
  const initPoolData = Buffer.alloc(11);
  INIT_POOL_DISCRIMINATOR.copy(initPoolData, 0);
  initPoolData.writeUInt8(TREE_DEPTH, 8);
  initPoolData.writeUInt16LE(ROOT_HISTORY_SIZE, 9);

  const initPoolIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolConfig, isSigner: false, isWritable: true },
      { pubkey: merkleTree, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initPoolData,
  });

  const tx1 = new Transaction();
  tx1.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
  tx1.add(initPoolIx);

  try {
    const sig1 = await sendAndConfirmTransaction(connection, tx1, [authority], {
      commitment: "confirmed",
    });
    console.log("   ✅ Pool initialized! TX:", sig1);
  } catch (e: any) {
    console.error("   ❌ Failed:", e.message);
    if (e.logs) console.error("   Logs:", e.logs.slice(-3));
    return;
  }

  // Wait for confirmation propagation
  await new Promise(r => setTimeout(r, 2000));

  // Step 2: Initialize Pending Deposits Buffer
  console.log("\n🔧 Step 2: Initializing Pending Buffer...");

  const initPendingIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: poolConfig, isSigner: false, isWritable: false },
      { pubkey: pendingBuffer, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: INIT_PENDING_DISCRIMINATOR,
  });

  const tx2 = new Transaction();
  tx2.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
  tx2.add(initPendingIx);

  try {
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [authority], {
      commitment: "confirmed",
    });
    console.log("   ✅ Pending buffer initialized! TX:", sig2);
  } catch (e: any) {
    console.error("   ❌ Failed:", e.message);
    if (e.logs) console.error("   Logs:", e.logs.slice(-3));
    return;
  }

  // Success output
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                    ✅ POOL CREATED SUCCESSFULLY                ");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\n📋 Update your Replit sequencer (src/sequencer.js) CONFIG:\n");
  console.log(`   POOL_CONFIG: '${poolConfig.toString()}',`);
  console.log(`   MERKLE_TREE: '${merkleTree.toString()}',`);
  console.log(`   PENDING_BUFFER: '${pendingBuffer.toString()}',`);
  console.log("\n📋 Next steps:");
  console.log("   1. Upload verification keys (upload-all-vks.ts)");
  console.log("   2. Register assets (register-assets.ts)");
  console.log("   3. Update frontend config with new pool address");
  console.log("   4. Start the Replit sequencer");
  console.log("");
}

main().catch(console.error);
