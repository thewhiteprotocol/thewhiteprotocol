/**
 * Initialize Pending Deposits Account
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("Hbkbx1EJiAQYsdFCEFhCZ1RWdBoUH3sXLX63KwYsRdfd");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  // Derive pending deposits PDA
  const [pendingDeposits] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("Authority:", authority.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());
  console.log("Pending Deposits:", pendingDeposits.toString());

  // Check if already exists
  const acc = await provider.connection.getAccountInfo(pendingDeposits);
  if (acc) {
    console.log("\n✅ Pending deposits already initialized");
    return;
  }

  // Initialize
  console.log("\n🚀 Initializing pending deposits...");
  
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  const [complianceConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  try {
    const tx = await (program.methods as any)
      .initializePoolRegistries()
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        merkleTree: merkleTree,
        relayerRegistry: relayerRegistry,
        complianceConfig: complianceConfig,
        pendingDeposits: pendingDeposits,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    
    console.log("\n✅ Pending deposits initialized!");
    console.log("Tx:", tx);
  } catch (e: any) {
    console.error("\n❌ Error:", e.message);
    if (e.logs) console.error("Logs:", e.logs.slice(-5));
  }
}

main().catch(console.error);
