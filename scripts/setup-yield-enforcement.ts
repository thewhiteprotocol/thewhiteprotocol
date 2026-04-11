import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

// FEATURE_YIELD_ENFORCEMENT = 1 << 5 = 32
const FEATURE_YIELD_ENFORCEMENT = 32;

// Known LST mints on devnet
const JITOSOL_MINT = new PublicKey("J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn");
const MSOL_MINT = new PublicKey("mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("./target/idl/white_protocol.json", "utf-8"));
  const program = new anchor.Program(idl, provider);
  
  const authority = provider.wallet.publicKey;
  console.log("Authority:", authority.toBase58());
  console.log("Pool Config:", POOL_CONFIG.toBase58());
  
  // Derive YieldRegistry PDA
  const [yieldRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log("Yield Registry:", yieldRegistry.toBase58());
  
  // Step 1: Enable FEATURE_YIELD_ENFORCEMENT
  console.log("\n=== Step 1: Enable FEATURE_YIELD_ENFORCEMENT ===");
  try {
    const tx1 = await program.methods
      .enableFeature(FEATURE_YIELD_ENFORCEMENT)
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
      })
      .rpc();
    console.log("✓ Yield enforcement enabled:", tx1);
  } catch (e: any) {
    if (e.message?.includes("already")) {
      console.log("⚠ Feature already enabled");
    } else {
      console.log("Error:", e.message);
    }
  }
  
  // Step 2: Add JitoSOL as yield mint
  console.log("\n=== Step 2: Add JitoSOL yield mint ===");
  try {
    const tx2 = await program.methods
      .addYieldMint(JITOSOL_MINT)
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        yieldRegistry: yieldRegistry,
      })
      .rpc();
    console.log("✓ JitoSOL added:", tx2);
  } catch (e: any) {
    if (e.message?.includes("already") || e.message?.includes("AlreadyExists")) {
      console.log("⚠ JitoSOL already registered");
    } else {
      console.log("Error:", e.message);
    }
  }
  
  // Step 3: Add mSOL as yield mint
  console.log("\n=== Step 3: Add mSOL yield mint ===");
  try {
    const tx3 = await program.methods
      .addYieldMint(MSOL_MINT)
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        yieldRegistry: yieldRegistry,
      })
      .rpc();
    console.log("✓ mSOL added:", tx3);
  } catch (e: any) {
    if (e.message?.includes("already") || e.message?.includes("AlreadyExists")) {
      console.log("⚠ mSOL already registered");
    } else {
      console.log("Error:", e.message);
    }
  }
  
  // Verify state
  console.log("\n=== Final State ===");
  const poolData = await program.account.poolConfigV2.fetch(POOL_CONFIG);
  console.log("Pool feature_flags:", poolData.featureFlags);
  console.log("Yield enforcement enabled:", (poolData.featureFlags & FEATURE_YIELD_ENFORCEMENT) !== 0);
  
  const registryData = await program.account.yieldRegistry.fetch(yieldRegistry);
  console.log("Yield mint count:", registryData.mintCount);
  console.log("Registered mints:", registryData.mints.filter((m: PublicKey) => !m.equals(PublicKey.default)).map((m: PublicKey) => m.toBase58()));
}

main().catch(console.error);
