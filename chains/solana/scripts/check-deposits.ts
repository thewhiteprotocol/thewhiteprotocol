import { PublicKey, Connection } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");
const MERKLE_TREE = new PublicKey("E1vS4WWQZ6j3jrbtr9gE8yotTAVqq1HNqEWN7ybjC8s3");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  // Merkle tree state
  const mt = await connection.getAccountInfo(MERKLE_TREE);
  if (mt) {
    // Layout: 8 disc + 32 pool + 1 depth + 4 leaf_count + ...
    const depth = mt.data[40];
    const leafCount = mt.data.readUInt32LE(41);
    console.log("Merkle Tree:", MERKLE_TREE.toBase58());
    console.log("  Depth:", depth);
    console.log("  Leaf count:", leafCount);
  }
  
  // Pending buffer
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_deposits"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const pb = await connection.getAccountInfo(pendingBuffer);
  if (pb) {
    // Layout: 8 disc + 32 pool + 2 count + deposits...
    const count = pb.data.readUInt16LE(40);
    console.log("\nPending Buffer:", pendingBuffer.toBase58());
    console.log("  Pending count:", count);
    
    // Read first few pending commitments
    if (count > 0) {
      console.log("  Pending deposits:");
      for (let i = 0; i < Math.min(count, 4); i++) {
        // Each PendingDeposit: commitment (32) + amount (8) + asset_id (32) + timestamp (8) = 80 bytes
        const start = 42 + i * 80;
        const commitment = pb.data.slice(start, start + 32);
        const amount = pb.data.readBigUInt64LE(start + 32);
        console.log(`    ${i}: amount=${Number(amount)/1e9} commitment=${commitment.slice(0,8).toString('hex')}...`);
      }
    }
  }
}
main().catch(console.error);
