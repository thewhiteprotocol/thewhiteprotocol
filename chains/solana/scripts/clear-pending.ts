import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const POOL_CONFIG = new PublicKey("iWMNRMHKS6zFKaNX1WkCBD3vsdnW4L24qd5Cp7sgLRV");
const PENDING_BUFFER = new PublicKey("3K1GH9JUmoigMu7UTRYmDX9YZ7ZeeHq3r1cVZfKyzzMR");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(require("fs").readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  console.log("Clearing pending buffer...");
  
  const tx = await program.methods
    .clearPendingBuffer()
    .accounts({
      authority: provider.wallet.publicKey,
      poolConfig: POOL_CONFIG,
      pendingBuffer: PENDING_BUFFER,
    })
    .rpc();
  
  console.log("✅ Cleared! Tx:", tx);
}

main().catch(console.error);
