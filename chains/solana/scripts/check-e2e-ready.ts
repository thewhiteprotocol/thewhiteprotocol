import { PublicKey, Connection } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const [withdrawV2Vk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw_v2"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_deposits"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [yieldRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  E2E TEST READINESS CHECK");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // WithdrawV2 VK
  const vk = await connection.getAccountInfo(withdrawV2Vk);
  console.log(`WithdrawV2 VK: ${vk ? "✅ EXISTS" : "❌ MISSING"}`);
  if (vk) console.log(`  Address: ${withdrawV2Vk.toBase58()}`);

  // Merkle tree
  const mt = await connection.getAccountInfo(merkleTree);
  if (mt) {
    const leafCount = mt.data.readUInt32LE(41);
    console.log(`Merkle Tree: ✅ EXISTS (${leafCount} leaves)`);
  }

  // Pending deposits
  const pb = await connection.getAccountInfo(pendingBuffer);
  if (pb) {
    const count = pb.data.readUInt16LE(40);
    console.log(`Pending Buffer: ${count} pending deposits`);
  }

  // Yield registry
  const yr = await connection.getAccountInfo(yieldRegistry);
  if (yr) {
    const mintCount = yr.data[328];
    console.log(`Yield Registry: ✅ ${mintCount} mints registered`);
  }

  // Pool feature flags
  const pool = await connection.getAccountInfo(POOL_CONFIG);
  if (pool) {
    const featureFlags = pool.data[260];
    console.log(`Feature Flags: ${featureFlags} (yield enforcement: ${(featureFlags & 32) !== 0})`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
