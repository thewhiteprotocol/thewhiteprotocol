import { PublicKey, Connection } from "@solana/web3.js";
import * as bs58 from "bs58";

const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const account = await connection.getAccountInfo(POOL_CONFIG);
  if (!account) return;
  
  const data = account.data;
  // PoolConfigV2 layout:
  // 8: discriminator
  // 32: authority
  // 32: pending_authority (or 1+32 for Option)
  // 32: merkle_tree (around 0x48)
  
  // Check offset 0x48 (72 decimal)
  const merkleTreeBytes = data.slice(72, 104);
  const merkleTree = new PublicKey(merkleTreeBytes);
  console.log("Merkle Tree:", merkleTree.toBase58());
  
  // Check if it exists
  const mtAccount = await connection.getAccountInfo(merkleTree);
  console.log("Exists:", !!mtAccount);
  if (mtAccount) {
    console.log("Size:", mtAccount.data.length, "bytes");
  }
}
main().catch(console.error);
