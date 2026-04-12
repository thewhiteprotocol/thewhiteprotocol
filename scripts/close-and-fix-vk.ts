/**
 * Close the wrong VK account and reinitialize with correct proof type
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as fs from 'fs';

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

// Convert G1 point to bytes
function g1ToBytes(g1: string[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < 2; i++) {
    const val = BigInt(g1[i]);
    const hex = val.toString(16).padStart(64, '0');
    for (let j = 0; j < 64; j += 2) {
      bytes.push(parseInt(hex.substring(j, j + 2), 16));
    }
  }
  return bytes;
}

// Convert G2 point to bytes
function g2ToBytes(g2: string[][]): number[] {
  const bytes: number[] = [];
  for (let coord = 0; coord < 2; coord++) {
    for (let i = 0; i < 2; i++) {
      const val = BigInt(g2[coord][i]);
      const hex = val.toString(16).padStart(64, '0');
      for (let j = 0; j < 64; j += 2) {
        bytes.push(parseInt(hex.substring(j, j + 2), 16));
      }
    }
  }
  return bytes;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Close and Fix MerkleBatchUpdate VK");
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  
  // Get the merkle_batch VK PDA
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("VK PDA:", vkPda.toBase58());
  
  // Check account
  const account = await provider.connection.getAccountInfo(vkPda);
  if (!account) {
    console.log("VK account not found");
    return;
  }
  
  console.log("\nAccount info:");
  console.log("  Owner:", account.owner.toBase58());
  console.log("  Lamports:", account.lamports);
  console.log("  Data size:", account.data.length);
  
  // The account is owned by the program, so we can't directly close it
  // We need to use the program to close it or find another way
  
  // Check if there's a close instruction in the IDL
  const idl = JSON.parse(fs.readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const hasCloseInstruction = idl.instructions.some((ix: any) => 
    ix.name.toLowerCase().includes('close') && 
    ix.name.toLowerCase().includes('vk')
  );
  
  console.log("\nIDL check:");
  console.log("  Has VK close instruction:", hasCloseInstruction);
  
  // List all instructions
  console.log("\nAvailable instructions:");
  idl.instructions.forEach((ix: any) => {
    console.log(`  - ${ix.name}`);
  });
  
  // Try to find a way to reset the VK
  // Option 1: Check if there's a reinitialize or reset instruction
  // Option 2: Use a raw transaction to reassign the account
  
  console.log("\n⚠️  The VK account is owned by the program and is locked.");
  console.log("   Options to fix:");
  console.log("   1. Add a close_vk instruction to the program");
  console.log("   2. Use an admin instruction to unlock/reset the VK");
  console.log("   3. Create a new pool (already ruled out)");
  
  // Check for admin or emergency instructions
  const adminInstructions = idl.instructions.filter((ix: any) => 
    ix.name.toLowerCase().includes('admin') || 
    ix.name.toLowerCase().includes('emergency') ||
    ix.name.toLowerCase().includes('reset')
  );
  
  if (adminInstructions.length > 0) {
    console.log("\nPotential admin instructions found:");
    adminInstructions.forEach((ix: any) => {
      console.log(`  - ${ix.name}`);
    });
  }
  
  // Since we can't close the account, let's check if the program has a way to overwrite
  // even when locked (e.g., via an admin override)
  
  console.log("\n❌ Cannot close VK account directly.");
  console.log("   The account is owned by the program and there is no close instruction.");
  console.log("\nPossible solutions:");
  console.log("   1. Add a 'close_vk' or 'reset_vk' instruction to the program");
  console.log("   2. Deploy a program upgrade with the fix");
  console.log("   3. Use a different pool (not preferred)");
}

main().catch(console.error);
