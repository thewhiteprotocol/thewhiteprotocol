/**
 * Production Approach: Find Original Deposit Transaction
 * 
 * Parse DepositMaspEvent from transaction logs
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const HELIUS_RPC = "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343";
const PENDING_BUFFER = new PublicKey("DPxeTsLkZaWdenw6gqgU7M6arWhKbo99GDVf2gPtM4NH");
const SETTLEMENT_TX = "4zTPJKYd8YjTooyvUZbV3YgnZb99Xu7TqLvHD12vSpwbARaUPiEPn8Fy27hfgCrS15KQLwrSrtSV9zmr1uLJuAjs";

async function main() {
  console.log("🔍 Finding Original Deposit Transaction\n");

  const connection = new anchor.web3.Connection(HELIUS_RPC, "confirmed");
  
  console.log("📡 Fetching transactions for pending buffer...");
  
  // Get all signatures for pending buffer account
  const signatures = await connection.getSignaturesForAddress(
    PENDING_BUFFER,
    { limit: 100 }
  );
  
  console.log(`✓ Found ${signatures.length} transactions\n`);
  
  // Find deposits that happened BEFORE settlement
  const settlementInfo = signatures.find(s => s.signature === SETTLEMENT_TX);
  const settlementSlot = settlementInfo?.slot || 434755907;
  
  console.log("🔎 Looking for deposit TXs before settlement...");
  console.log(`   Settlement slot: ${settlementSlot}\n`);
  
  const depositTxs = signatures.filter(s => 
    s.slot < settlementSlot && 
    s.err === null
  );
  
  console.log(`📦 Found ${depositTxs.length} transactions before settlement:`);
  
  for (const sig of depositTxs.slice(0, 10)) {
    const tx = await connection.getTransaction(sig.signature, {
      maxSupportedTransactionVersion: 0,
    });
    
    if (!tx || !tx.meta?.logMessages) continue;
    
    // Check if it's a deposit
    const isDeposit = tx.meta.logMessages.some(log => 
      log.includes("Instruction: DepositMasp")
    );
    
    if (isDeposit) {
      console.log(`\n✓ Deposit TX: ${sig.signature.slice(0, 12)}... (slot ${sig.slot})`);
      
      // Extract commitment from logs
      const commitmentLog = tx.meta.logMessages.find(log => 
        log.includes("Program data:")
      );
      
      if (commitmentLog) {
        console.log("   Found DepositMaspEvent in logs");
        
        // Parse program data (base64 encoded event)
        const dataMatch = commitmentLog.match(/Program data: (.+)/);
        if (dataMatch) {
          const eventData = Buffer.from(dataMatch[1], 'base64');
          
          // DepositMaspEvent structure:
          // - discriminator (8 bytes)
          // - commitment (32 bytes)
          // - depositor (32 bytes)
          // - ...
          
          const commitment = eventData.slice(8, 40);
          console.log("   Commitment:", commitment.toString('hex'));
        }
      }
    }
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

main().catch(console.error);
