/**
 * Initialize Pending Deposits Buffer
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  // Derive pending deposits PDA
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("Authority:", authority.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());
  console.log("Pending Buffer:", pendingBuffer.toString());

  // Check if already exists
  const acc = await provider.connection.getAccountInfo(pendingBuffer);
  if (acc) {
    console.log("\n✅ Pending buffer already initialized");
    return;
  }

  // Initialize
  console.log("\n🚀 Initializing pending deposits buffer...");

  try {
    const tx = await (program.methods as any)
      .initializePendingDepositsBuffer()
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        pendingBuffer: pendingBuffer,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    
    console.log("\n✅ Pending buffer initialized!");
    console.log("Tx:", tx);
  } catch (e: any) {
    console.error("\n❌ Error:", e.message);
    if (e.logs) console.error("Logs:", e.logs.slice(-5));
  }
}

main().catch(console.error);
