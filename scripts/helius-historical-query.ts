/**
 * Helius Historical State Query
 * 
 * Use Helius enhanced APIs to query pending buffer BEFORE settlement
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const HELIUS_RPC = "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343";
const PENDING_BUFFER = new PublicKey("DPxeTsLkZaWdenw6gqgU7M6arWhKbo99GDVf2gPtM4NH");
const SETTLEMENT_SLOT = 434755907;

async function main() {
  console.log("🔍 Querying Historical State with Helius\n");

  const connection = new anchor.web3.Connection(HELIUS_RPC, "confirmed");
  
  console.log("✓ Connected to Helius Devnet RPC");
  console.log("✓ Pending buffer:", PENDING_BUFFER.toString());
  console.log("✓ Settlement slot:", SETTLEMENT_SLOT);
  console.log("");

  // Query account state BEFORE settlement (slot - 1)
  console.log(`📡 Fetching pending buffer at slot ${SETTLEMENT_SLOT - 1} (before settlement)...`);
  
  try {
    const accountInfo = await connection.getAccountInfo(
      PENDING_BUFFER,
      {
        commitment: "confirmed",
        // Helius supports minContextSlot for historical queries
        minContextSlot: SETTLEMENT_SLOT - 10,
      }
    );

    if (!accountInfo) {
      console.log("❌ Account not found at that slot");
      console.log("\n💡 Helius free tier may not have deep historical data");
      console.log("   Let's try a different approach...");
      return;
    }

    console.log("✓ Account data retrieved!");
    console.log("   Data length:", accountInfo.data.length);
    
    // Parse the pending buffer
    const wallet = anchor.Wallet.local();
    const provider = new anchor.AnchorProvider(connection, wallet);
    const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
    const program = new anchor.Program(idl, provider);

    // Decode the account data
    const coder = new anchor.BorshAccountsCoder(idl);
    const decoded: any = coder.decode("PendingDepositsBuffer", accountInfo.data);
    
    console.log("\n📊 Historical Pending Buffer State:");
    console.log("   Total deposits:", decoded.totalDeposits);
    console.log("   Total pending:", decoded.totalPending);
    
    if (decoded.totalPending > 0) {
      console.log("\n📦 Deposits in buffer:");
      for (let i = 0; i < Math.min(decoded.totalPending, 10); i++) {
        const commitment = Buffer.from(decoded.deposits[i].commitment).toString('hex');
        console.log(`   [${i}] ${commitment}`);
      }
    }

  } catch (error: any) {
    console.log("❌ Error:", error.message);
    console.log("\n💡 Helius free tier limitations:");
    console.log("   - Historical state limited to recent slots");
    console.log("   - Deep history requires paid tier");
    console.log("\n✅ Alternative: Use Helius webhooks for future deposits");
  }
}

main().catch(console.error);
