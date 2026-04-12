import { PublicKey, Connection } from "@solana/web3.js";

const MERKLE_TREE = new PublicKey("E1vS4WWQZ6j3jrbtr9gE8yotTAVqq1HNqEWN7ybjC8s3");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const mt = await connection.getAccountInfo(MERKLE_TREE);
  if (!mt) return;
  
  // Layout: 8 disc + 32 pool + 1 depth + 4 leaf_count + 32 current_root + 32*21 roots + leaves...
  // Actually need to check the exact layout
  const depth = mt.data[40];
  const leafCount = mt.data.readUInt32LE(41);
  
  // Current root at offset 45
  const currentRoot = mt.data.slice(45, 77);
  console.log("Current root:", BigInt('0x' + Buffer.from(currentRoot).toString('hex')).toString());
  
  // Historical roots: 21 * 32 = 672 bytes starting at 77
  // Leaves start at: 77 + 672 = 749
  // But let's check the actual structure from state
  console.log("\nMerkle data (first 200 bytes):");
  console.log(mt.data.slice(0, 200).toString('hex'));
}
main().catch(console.error);
