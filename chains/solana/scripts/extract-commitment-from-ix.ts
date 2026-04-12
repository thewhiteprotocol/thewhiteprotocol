/**
 * Extract commitment from instruction data (production approach)
 */

import * as anchor from "@coral-xyz/anchor";

const HELIUS_RPC = "https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343";
const DEPOSIT_TX = "3MxAezweLfJ77wpH1S1NjAhJ98mE8srCyEM767mtvxLECHkpPywP1xUf5ZSr5vER4CjxWmbEJdtFNzQnVXgVuUBq";

async function main() {
  console.log("🔍 Extracting Commitment from Instruction Data\n");

  const connection = new anchor.web3.Connection(HELIUS_RPC, "confirmed");
  
  const tx = await connection.getTransaction(DEPOSIT_TX, {
    maxSupportedTransactionVersion: 0,
  });
  
  if (!tx) return;
  
  console.log("✓ Transaction found");
  
  // Find the depositMasp instruction
  const programIx = tx.transaction.message.compiledInstructions.find(ix => {
    const programId = tx.transaction.message.staticAccountKeys[ix.programIdIndex];
    return programId.toString() === "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb";
  });
  
  if (!programIx) {
    console.log("❌ Program instruction not found");
    return;
  }
  
  console.log("✓ Found depositMasp instruction");
  console.log("   Data length:", programIx.data.length, "bytes");
  console.log("");
  
  // depositMasp instruction data format:
  // - discriminator (8 bytes)
  // - amount (8 bytes u64)
  // - commitment (32 bytes)
  // - asset_id (32 bytes)
  // - proof_data (256 bytes)
  // - encrypted_note (Option<Vec<u8>>)
  
  const data = Buffer.from(programIx.data);
  
  console.log("📊 Parsing instruction data:");
  const discriminator = data.slice(0, 8);
  const amount = data.readBigUInt64LE(8);
  const commitment = data.slice(16, 48);
  const assetId = data.slice(48, 80);
  
  console.log("   Discriminator:", discriminator.toString('hex'));
  console.log("   Amount:", amount.toString(), "lamports");
  console.log("   Commitment:", commitment.toString('hex'));
  console.log("   Asset ID:", assetId.toString('hex').slice(0, 16) + "...");
  
  console.log("");
  console.log("✅ FOUND THE SETTLED COMMITMENT!");
  console.log("");
  console.log("Save this to past_commitments.json:");
  console.log(`   "${commitment.toString('hex')}"`);
}

main().catch(console.error);
