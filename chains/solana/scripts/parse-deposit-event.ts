/**
 * Parse DepositMaspEvent from specific transaction
 */

import * as anchor from "@coral-xyz/anchor";

const HELIUS_RPC = "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343";
const DEPOSIT_TX = "5K35qGYR28RWgqUqF27TEeTqGoPQPyaHrWc7iaArfQ4CEu55djK5TTinHgJYUgxNRqo828jLPFu3wkeaHaBiTygz";

async function main() {
  console.log("🔍 Parsing Deposit Transaction Event\n");

  const connection = new anchor.web3.Connection(HELIUS_RPC, "confirmed");
  
  console.log("📡 Fetching transaction:", DEPOSIT_TX.slice(0, 20) + "...");
  
  const tx = await connection.getTransaction(DEPOSIT_TX, {
    maxSupportedTransactionVersion: 0,
  });
  
  if (!tx || !tx.meta) {
    console.log("❌ Transaction not found");
    return;
  }
  
  console.log("✓ Transaction found");
  console.log("   Slot:", tx.slot);
  console.log("");
  
  console.log("📋 Transaction logs:");
  if (tx.meta.logMessages) {
    tx.meta.logMessages.forEach((log, i) => {
      console.log(`   [${i}] ${log}`);
    });
  }
  
  console.log("");
  console.log("🔎 Looking for Program data (event emission)...");
  
  const programDataLog = tx.meta.logMessages?.find(log => 
    log.includes("Program data:")
  );
  
  if (programDataLog) {
    const dataMatch = programDataLog.match(/Program data: (.+)/);
    if (dataMatch) {
      const eventData = Buffer.from(dataMatch[1], 'base64');
      
      console.log("✓ Event data found, length:", eventData.length);
      console.log("");
      
      // DepositMaspEvent structure (from IDL):
      // - discriminator (8 bytes)
      // - commitment (32 bytes) 
      // - depositor (32 bytes)
      // - amount (8 bytes)
      // - asset_id (32 bytes)
      // - timestamp (8 bytes)
      
      console.log("📊 Parsing DepositMaspEvent:");
      const commitment = eventData.slice(8, 40);
      const depositor = eventData.slice(40, 72);
      
      console.log("   Commitment:", commitment.toString('hex'));
      console.log("   Depositor:", new anchor.web3.PublicKey(depositor).toString());
      
      console.log("");
      console.log("✅ Found the settled commitment!");
      console.log("   This should be saved as leaf index 0");
    }
  } else {
    console.log("❌ No Program data found in logs");
  }
}

main().catch(console.error);
