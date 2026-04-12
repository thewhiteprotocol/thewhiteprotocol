/**
 * Manual parsing of historical pending buffer
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const HELIUS_RPC = "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343";
const PENDING_BUFFER = new PublicKey("DPxeTsLkZaWdenw6gqgU7M6arWhKbo99GDVf2gPtM4NH");

async function main() {
  console.log("🔍 Manual Parsing of Historical Buffer\n");

  const connection = new anchor.web3.Connection(HELIUS_RPC, "confirmed");
  
  // Get current state to see the structure
  console.log("📡 Fetching CURRENT buffer state for comparison...");
  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet);
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  
  const current: any = await program.account.pendingDepositsBuffer.fetch(PENDING_BUFFER);
  
  console.log("✓ Current state:");
  console.log("   Total pending:", current.totalPending);
  console.log("   Total batched:", current.totalDepositsBatched.toString());
  console.log("");
  
  console.log("📊 Current deposits:");
  for (let i = 0; i < current.totalPending; i++) {
    const commitment = Buffer.from(current.deposits[i].commitment).toString('hex');
    console.log(`   [${i}] ${commitment}`);
  }
  
  console.log("\n💡 Analysis:");
  console.log("   Current: 3 pending deposits at indices 0,1,2");
  console.log("   Settlement TX cleared 1 deposit from position 0");
  console.log("   That deposit is now at leaf index 0 in Merkle tree");
  console.log("");
  console.log("✅ Solution: Use deposit TX signature to extract commitment");
  console.log("   Each deposit emits DepositMaspEvent with commitment");
}

main().catch(console.error);
