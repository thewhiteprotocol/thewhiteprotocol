import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const poolConfig = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
  const programId = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
  
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), poolConfig.toBuffer()],
    programId
  );
  
  console.log("Checking Merkle Batch VK...");
  console.log("VK PDA:", vkPda.toBase58());
  
  const account = await provider.connection.getAccountInfo(vkPda);
  if (!account) {
    console.log("❌ VK account does not exist");
    return;
  }
  
  console.log("✓ VK account exists");
  console.log("  Data length:", account.data.length);
  
  // Read proof type and initialized flag from account data
  // Account layout: discriminator(8) + ... + proof_type(1) + is_initialized(1) + ...
  const proofType = account.data[40];
  const isInitialized = account.data[41];
  
  const proofTypes = ['Deposit', 'Withdraw', 'JoinSplit', 'MerkleBatchUpdate', 'Membership', 'WithdrawV2'];
  console.log("  Proof type:", proofType, `(${proofTypes[proofType] || 'Unknown'})`);
  console.log("  Is initialized:", isInitialized === 1 ? "Yes" : "No");
  
  // Check if VK is locked
  const poolData = await provider.connection.getAccountInfo(poolConfig);
  if (poolData) {
    // vk_locked is at offset around 219 in pool config
    // Just fetch the pool account via program
    const idl = JSON.parse(require('fs').readFileSync('./target/idl/white_protocol.json', 'utf8'));
    const program = new anchor.Program(idl, provider);
    const pool = await (program.account as any).poolConfig.fetch(poolConfig);
    console.log("  VK Configured bitmask:", pool.vkConfigured);
    console.log("  VK Locked bitmask:", pool.vkLocked);
    
    // Check if merkle batch VK is configured (bit 4 = 16)
    const isConfigured = (pool.vkConfigured & 16) !== 0;
    const isLocked = (pool.vkLocked & 16) !== 0;
    console.log("  MerkleBatchUpdate VK configured:", isConfigured);
    console.log("  MerkleBatchUpdate VK locked:", isLocked);
  }
}

main().catch(console.error);
