import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

// pool-authority-fresh.json pool
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("./target/idl/white_protocol.json", "utf-8"));
  const program = new anchor.Program(idl, provider);
  
  const authority = provider.wallet.publicKey;
  console.log("Authority:", authority.toBase58());
  console.log("Pool Config:", POOL_CONFIG.toBase58());
  
  // Derive YieldRegistry PDA
  const [yieldRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log("Yield Registry:", yieldRegistry.toBase58());
  
  // Check if already exists
  const info = await provider.connection.getAccountInfo(yieldRegistry);
  if (info) {
    console.log("✓ YieldRegistry already initialized");
    return;
  }
  
  // Initialize
  const tx = await program.methods
    .initYieldRegistry()
    .accounts({
      authority: authority,
      poolConfig: POOL_CONFIG,
      yieldRegistry: yieldRegistry,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  
  console.log("✓ YieldRegistry initialized:", tx);
}

main().catch(console.error);
