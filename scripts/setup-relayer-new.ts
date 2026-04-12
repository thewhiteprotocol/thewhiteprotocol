/**
 * Setup Relayer - New Deployment
 * Program ID: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  // Derive PDAs
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [relayerNode] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer"), relayerRegistry.toBuffer(), authority.toBuffer()],
    PROGRAM_ID
  );

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("           Setting Up Relayer");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Authority:", authority.toString());
  console.log("Relayer Registry:", relayerRegistry.toString());
  console.log("Relayer Node:", relayerNode.toString());

  try {
    // Register relayer
    const tx = await (program.methods as any)
      .registerRelayer(100, "https://thewhiteprotocol.org/relayer") // 0.5% fee (50 bps)
      .accounts({
        operator: authority,
        poolConfig: POOL_CONFIG,
        relayerRegistry: relayerRegistry,
        relayerNode: relayerNode,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    
    console.log("\n✅ Relayer registered!");
    console.log("Tx:", tx);
    console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);

  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("\n✅ Relayer already registered");
    } else {
      console.error("\nError:", e.message?.slice(0, 300) || e);
    }
  }

  // Fund pool authority for future operations
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("           Deployment Summary");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\nProgram ID:", PROGRAM_ID.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());
  console.log("Merkle Tree:", (await PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()], PROGRAM_ID
  ))[0].toString());
  console.log("Relayer Registry:", relayerRegistry.toString());
  console.log("Compliance Config:", (await PublicKey.findProgramAddressSync(
    [Buffer.from("compliance"), POOL_CONFIG.toBuffer()], PROGRAM_ID
  ))[0].toString());
  console.log("Asset Vault (wSOL):", (await PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), POOL_CONFIG.toBuffer(), Buffer.from("004a067d98373879008ada3415ad678dcd5354c0b29b52233a604774c94a82e0", "hex")],
    PROGRAM_ID
  ))[0].toString());
}

main().catch(console.error);
