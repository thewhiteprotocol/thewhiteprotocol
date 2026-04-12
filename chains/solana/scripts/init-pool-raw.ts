import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

const INIT_POOL_DISCRIMINATOR = Buffer.from([0xcf, 0x2d, 0x57, 0xf2, 0x1b, 0x3f, 0xcc, 0x43]);
const INIT_PENDING_DISCRIMINATOR = Buffer.from([0x54, 0x9a, 0xb1, 0x17, 0x4d, 0x11, 0x46, 0x2f]);

async function main() {
  const connection = new Connection(
    "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343",
    "confirmed"
  );

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  console.log("Authority:", authority.publicKey.toString());
  console.log("Balance:", await connection.getBalance(authority.publicKey) / 1e9, "SOL");

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

  console.log("\nNew Pool Addresses:");
  console.log("  Pool Config:", poolConfig.toString());
  console.log("  Merkle Tree:", merkleTree.toString());
  console.log("  Pending Buffer:", pendingBuffer.toString());

  const poolAccount = await connection.getAccountInfo(poolConfig);
  if (poolAccount) {
    console.log("\n⚠️  Pool already exists!");
    return;
  }

  // Args: tree_depth (u8), root_history_size (u16)
  const treeDepth = 20;
  const rootHistorySize = 100;
  
  const argsBuffer = Buffer.alloc(3); // 1 byte u8 + 2 bytes u16
  argsBuffer.writeUInt8(treeDepth, 0);
  argsBuffer.writeUInt16LE(rootHistorySize, 1);
  
  const initPoolData = Buffer.concat([INIT_POOL_DISCRIMINATOR, argsBuffer]);

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

  console.log("\n🔧 Step 1: Initialize Pool + Merkle Tree...");
  
  const tx1 = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }))
    .add(initPoolIx);
  
  tx1.feePayer = authority.publicKey;
  tx1.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const sig1 = await sendAndConfirmTransaction(connection, tx1, [authority], { commitment: "confirmed" });
  console.log("✅ Pool initialized! TX:", sig1);

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

  console.log("\n🔧 Step 2: Initialize Pending Buffer...");
  
  const tx2 = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }))
    .add(initPendingIx);
  
  tx2.feePayer = authority.publicKey;
  tx2.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const sig2 = await sendAndConfirmTransaction(connection, tx2, [authority], { commitment: "confirmed" });
  console.log("✅ Pending buffer initialized! TX:", sig2);

  console.log("\n" + "=".repeat(60));
  console.log("✅ FRESH POOL READY!");
  console.log("=".repeat(60));
  console.log("\n📋 Update Replit config.ts with these addresses:");
  console.log(`
export const DEVNET_CONFIG = {
  POOL_CONFIG: "${poolConfig.toString()}",
  MERKLE_TREE: "${merkleTree.toString()}",
  PENDING_BUFFER: "${pendingBuffer.toString()}",
  PROGRAM_ID: "${PROGRAM_ID.toString()}",
};
`);
}

main().catch(console.error);
