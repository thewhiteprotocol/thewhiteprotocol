import { PublicKey, Connection } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");
const JITOSOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const MSOL_MINT = new PublicKey("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So");
const TEST_MINT = new PublicKey("8bPgZcLxRV62dyXQCLYHKaZHwcLC739XxF94yHAmmSvD");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const [yieldRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  YIELD REGISTRY VERIFICATION");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const account = await connection.getAccountInfo(yieldRegistry);
  if (!account) {
    console.log("Yield registry not found!");
    return;
  }

  const data = account.data;
  
  // Parse YieldRegistry struct
  // Layout: 8 (disc) + 32 (pool_config) + 32 (authority) + 256 (mints) + 1 (count) + 1 (bump)
  const poolConfig = new PublicKey(data.slice(8, 40));
  const authority = new PublicKey(data.slice(40, 72));
  const mintCount = data[328];
  const bump = data[329];
  
  console.log("Pool Config:", poolConfig.toBase58());
  console.log("Authority:  ", authority.toBase58());
  console.log("Mint Count: ", mintCount);
  console.log("Bump:       ", bump);
  console.log("");
  
  console.log("Registered Yield Mints:");
  const mints: PublicKey[] = [];
  for (let i = 0; i < 8; i++) {
    const start = 72 + (i * 32);
    const mintPubkey = new PublicKey(data.slice(start, start + 32));
    mints.push(mintPubkey);
    
    if (!mintPubkey.equals(PublicKey.default)) {
      let label = "";
      if (mintPubkey.equals(JITOSOL_MINT)) label = " (JitoSOL)";
      else if (mintPubkey.equals(MSOL_MINT)) label = " (mSOL)";
      else if (mintPubkey.equals(TEST_MINT)) label = " (Test Yield Token)";
      console.log(`  ${i + 1}. ${mintPubkey.toBase58()}${label}`);
    }
  }
  
  // Verify expected mints
  console.log("");
  console.log("Verification:");
  const hasJito = mints.some(m => m.equals(JITOSOL_MINT));
  const hasMsol = mints.some(m => m.equals(MSOL_MINT));
  const hasTest = mints.some(m => m.equals(TEST_MINT));
  
  console.log(`  JitoSOL registered: ${hasJito ? "✓" : "✗"}`);
  console.log(`  mSOL registered:    ${hasMsol ? "✓" : "✗"}`);
  console.log(`  Test mint registered: ${hasTest ? "✓" : "✗"}`);
  
  // Check pool config feature flags
  const poolAccount = await connection.getAccountInfo(POOL_CONFIG);
  if (poolAccount) {
    // PoolConfigV2: feature_flags at offset 260 (0x104)
    const featureFlags = poolAccount.data[260];
    const yieldEnforcement = (featureFlags & 32) !== 0;
    console.log(`  Yield enforcement enabled: ${yieldEnforcement ? "✓" : "✗"} (flags=${featureFlags})`);
  }
  
  console.log("");
  if (hasJito && hasMsol && hasTest && mintCount === 3) {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  ✅ YIELD REGISTRY CORRECTLY CONFIGURED");
    console.log("═══════════════════════════════════════════════════════════════");
  }
}

main().catch(console.error);
