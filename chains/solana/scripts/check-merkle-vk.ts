import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from 'fs';

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl as anchor.Idl, provider);
  
  // Pool config
  const poolConfig = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
  
  // Derive VK PDA for MerkleBatchUpdate
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_v2"), Buffer.from("merkle_batch"), poolConfig.toBuffer()],
    program.programId
  );
  
  console.log("Checking VK at:", vkPda.toBase58());
  
  try {
    const vkAccount = await program.account.verificationKeyAccountV2.fetch(vkPda);
    console.log("✓ VK Account found!");
    console.log("  Proof Type:", Object.keys(vkAccount.proofType)[0]);
    console.log("  IC Length:", vkAccount.ic.length);
    console.log("  Is Locked:", vkAccount.isLocked);
    
    // Compare with local VK
    const localVk = JSON.parse(fs.readFileSync('./circuits/build/merkle_batch_update/verification_key.json', 'utf8'));
    console.log("\nLocal VK:");
    console.log("  IC Length:", localVk.IC.length);
    
    if (vkAccount.ic.length === localVk.IC.length) {
      console.log("\n✓ VK IC count matches!");
    } else {
      console.log("\n✗ VK IC count mismatch!");
    }
  } catch (e) {
    console.log("✗ VK Account not found or error:", e.message);
  }
}

main().catch(console.error);
