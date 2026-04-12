import { PublicKey, Connection } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_deposits"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  
  console.log("Merkle Tree:", merkleTree.toBase58());
  console.log("Pending Buffer:", pendingBuffer.toBase58());
  
  const mtAccount = await connection.getAccountInfo(merkleTree);
  if (mtAccount) {
    const leafCount = mtAccount.data.readUInt32LE(41);
    console.log("\nMerkle Tree leaf_count:", leafCount);
    console.log("Merkle Tree data length:", mtAccount.data.length);
  }
  
  const pbAccount = await connection.getAccountInfo(pendingBuffer);
  if (pbAccount) {
    const count = pbAccount.data.readUInt16LE(40);
    console.log("\nPending deposits count:", count);
  } else {
    console.log("\nPending buffer not found");
  }
  
  const [withdrawVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk"), POOL_CONFIG.toBuffer(), Buffer.from([1])],
    PROGRAM_ID
  );
  const vkAccount = await connection.getAccountInfo(withdrawVk);
  console.log("\nWithdraw VK exists:", !!vkAccount);
  if (vkAccount) console.log("Withdraw VK:", withdrawVk.toBase58());
}

main().catch(console.error);
