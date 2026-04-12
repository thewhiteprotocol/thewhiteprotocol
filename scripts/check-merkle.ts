import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const poolConfig = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
  
  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), poolConfig.toBuffer()],
    new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW")
  );
  
  console.log("Merkle Tree PDA:", merkleTreePda.toBase58());
  
  const idl = JSON.parse(require('fs').readFileSync('./target/idl/white_protocol.json', 'utf8'));
  const program = new anchor.Program(idl, provider);
  
  const merkleTree = await (program.account as any).merkleTree.fetch(merkleTreePda);
  
  console.log("\nMerkle Tree State:");
  console.log("  Depth:", merkleTree.depth);
  console.log("  Next Leaf Index:", merkleTree.nextLeafIndex.toString());
  console.log("  Current Root:", Buffer.from(merkleTree.currentRoot).toString('hex'));
  console.log("  Total Leaves:", merkleTree.totalLeaves.toString());
  console.log("  Root History Index:", merkleTree.rootHistoryIndex);
  console.log("  Root History Size:", merkleTree.rootHistory.length);
  
  // Check pending buffer
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), poolConfig.toBuffer()],
    new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW")
  );
  
  try {
    const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
    console.log("\nPending Buffer State:");
    console.log("  Deposits count:", pendingBuffer.deposits?.length || 0);
    console.log("  Total pending:", pendingBuffer.totalPending?.toString() || 'unknown');
    
    if (pendingBuffer.deposits && pendingBuffer.deposits.length > 0) {
      console.log("\n  First pending deposit commitment:");
      const firstCommitment = Buffer.from(pendingBuffer.deposits[0].commitment);
      console.log("   ", firstCommitment.toString('hex'));
    }
  } catch (e: any) {
    console.log("\nCould not fetch pending buffer:", e.message);
  }
}

main().catch(console.error);
