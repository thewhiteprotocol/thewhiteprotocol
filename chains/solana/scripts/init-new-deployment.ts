/**
 * The White Protocol - New Deployment Initialization
 * Program ID: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const TREE_DEPTH = 20;
const ROOT_HISTORY_SIZE = 100;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(require("fs").readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  // Derive PDAs with correct seeds
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("white_pool"), authority.toBuffer()],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [complianceConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [pendingDeposits] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), poolConfig.toBuffer()],
    PROGRAM_ID
  );

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("      The White Protocol - Deployment Initialization");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Authority:", authority.toString());
  console.log("\nPDAs:");
  console.log("  Pool Config:", poolConfig.toString());
  console.log("  Merkle Tree:", merkleTree.toString());
  console.log("  Pending Deposits:", pendingDeposits.toString());
  console.log("  Relayer Registry:", relayerRegistry.toString());
  console.log("  Compliance Config:", complianceConfig.toString());

  // Step 1: Initialize Pool Registries
  console.log("\n📋 Step 1: Initializing Pool Registries...");
  try {
    const tx1 = await (program.methods as any)
      .initializePoolRegistries()
      .accounts({
        authority: authority,
        poolConfig: poolConfig,
        relayerRegistry: relayerRegistry,
        complianceConfig: complianceConfig,
        pendingDeposits: pendingDeposits,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    console.log("  ✅ Registries initialized!");
    console.log("  Tx:", tx1);
  } catch (e: any) {
    console.error("  Error:", e.message?.slice(0, 200) || e);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                    Initialization Complete!");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
