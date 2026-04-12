/**
 * Full Initialization for The White Protocol v2 (New Program)
 * Program ID: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");

// Deployer authority
const AUTHORITY = new PublicKey("8JQmzyFhPQzzL8TBNJoQwzLZDqnBNx2SZPkseUUdvgey");

// PDAs computed for new deployment
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const MERKLE_TREE = new PublicKey("2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD");
const PENDING_BUFFER = new PublicKey("7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw");
const RELAYER_REGISTRY = new PublicKey("AcUnzSAhGoT5mou11TjwzkaibyoS2z7vQxMimEXujyQe");
const COMPLIANCE_CONFIG = new PublicKey("E2vhGgW4jf28NTuGJmm2qdn4SLhc59A6RUzXem7o7RMx");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Initializing The White Protocol v2");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Program ID:", PROGRAM_ID.toString());
  console.log("Authority:", authority.toString());
  console.log("\nExpected PDAs:");
  console.log("  Pool Config:", POOL_CONFIG.toString());
  console.log("  Merkle Tree:", MERKLE_TREE.toString());
  console.log("  Pending Buffer:", PENDING_BUFFER.toString());
  console.log("  Relayer Registry:", RELAYER_REGISTRY.toString());
  console.log("  Compliance Config:", COMPLIANCE_CONFIG.toString());

  // Step 1: Initialize Pool
  console.log("\n📋 Step 1: Initializing Pool + Merkle Tree...");
  try {
    const tx1 = await (program.methods as any)
      .initializePoolV2(20, 100) // depth=20, root_history=100
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        merkleTree: MERKLE_TREE,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    console.log("  ✅ Pool initialized! Tx:", tx1.slice(0, 30));
  } catch (e: any) {
    console.log("  ⚠️ Pool may already exist:", e.message?.slice(0, 50));
  }

  // Step 2: Initialize Pending Buffer
  console.log("\n📋 Step 2: Initializing Pending Deposits Buffer...");
  try {
    const tx2 = await (program.methods as any)
      .initializePendingDepositsBuffer()
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        pendingBuffer: PENDING_BUFFER,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    console.log("  ✅ Pending buffer initialized! Tx:", tx2.slice(0, 30));
  } catch (e: any) {
    console.log("  ⚠️ Pending buffer may already exist:", e.message?.slice(0, 50));
  }

  // Step 3: Initialize Pool Registries
  console.log("\n📋 Step 3: Initializing Pool Registries...");
  try {
    const tx3 = await (program.methods as any)
      .initializePoolRegistries()
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        merkleTree: MERKLE_TREE,
        relayerRegistry: RELAYER_REGISTRY,
        complianceConfig: COMPLIANCE_CONFIG,
        pendingDeposits: PENDING_BUFFER,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    console.log("  ✅ Registries initialized! Tx:", tx3.slice(0, 30));
  } catch (e: any) {
    console.log("  ⚠️ Registries may already exist:", e.message?.slice(0, 50));
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Initialization Complete!");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
