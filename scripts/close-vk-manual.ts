/**
 * Manually construct and send close_vk_v2 transaction
 * Since the IDL wasn't updated during deployment
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import * as fs from 'fs';
import { BN } from "@coral-xyz/anchor";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

// Discriminator for close_vk_v2 instruction
// echo -n "global:close_vk_v2" | sha256sum | cut -d' ' -f1 | xxd -r -p | head -c 8 | xxd -p
const CLOSE_VK_DISCRIMINATOR = Buffer.from([0x32, 0x2c, 0x3d, 0x14, 0x1c, 0x83, 0x90, 0xac]);

// ProofType enum values
const PROOF_TYPE_MEMBERSHIP = 4;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Manually Close VK Account");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  
  // Get the merkle_batch VK PDA
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("VK PDA:", vkPda.toBase58());
  
  // Get pool config data to find bump
  const account = await provider.connection.getAccountInfo(vkPda);
  if (!account) {
    console.log("VK account not found");
    return;
  }
  
  console.log("\nAccount info:");
  console.log("  Lamports:", account.lamports);
  console.log("  Owner:", account.owner.toBase58());
  
  // The bump is stored at offset 40 + 1 + ... in the account data
  // Let's just try to construct the instruction manually
  
  // Build instruction data: discriminator + proof_type (u8)
  const data = Buffer.concat([
    CLOSE_VK_DISCRIMINATOR,
    Buffer.from([PROOF_TYPE_MEMBERSHIP]), // ProofType::Membership = 4
  ]);
  
  console.log("\nInstruction data:", data.toString('hex'));
  
  // Build accounts:
  // 0. authority (signer, writable)
  // 1. pool_config (writable)
  // 2. vk_account (writable)
  const keys = [
    { pubkey: provider.wallet.publicKey, isSigner: true, isWritable: true },
    { pubkey: POOL_CONFIG, isSigner: false, isWritable: true },
    { pubkey: vkPda, isSigner: false, isWritable: true },
  ];
  
  const ix = new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
  
  console.log("\n🚀 Sending close_vk_v2 transaction...");
  
  try {
    const tx = new Transaction().add(ix);
    tx.feePayer = provider.wallet.publicKey;
    
    const sig = await provider.sendAndConfirm(tx);
    console.log("✅ VK account closed!");
    console.log("  Signature:", sig);
    
    // Verify account is closed
    const after = await provider.connection.getAccountInfo(vkPda);
    if (!after) {
      console.log("  Account no longer exists (confirmed closed)");
    } else {
      console.log("  Account still exists (unexpected)");
      console.log("  Lamports:", after.lamports);
    }
    
  } catch (e: any) {
    console.error("❌ Failed:", e.message);
    if (e.logs) {
      console.log("\nLogs:");
      e.logs.forEach((log: string) => console.log("  ", log));
    }
  }
}

main().catch(console.error);
