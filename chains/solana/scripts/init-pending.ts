import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey(process.env.POOL_CONFIG || "FX26qtKeJN7fUPKfHF17bwhUv2Fah3rS2K1t9AVpcEXj");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("./target/idl/white_protocol.json", "utf-8"));
  const program = new anchor.Program(idl, provider);
  
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_deposits"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("Pending buffer PDA:", pendingBuffer.toBase58());
  console.log("Initializing...");
  
  const tx = await program.methods
    .initializePendingDepositsBuffer()
    .accounts({
      authority: provider.wallet.publicKey,
      poolConfig: POOL_CONFIG,
      pendingBuffer: pendingBuffer,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
  
  console.log("TX:", tx);
}

main().catch(console.error);
