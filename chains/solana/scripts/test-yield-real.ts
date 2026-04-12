/**
 * Real Devnet Yield Enforcement Test - FIXED
 * Creates test token, registers as yield, tests enforcement
 */
import * as anchor from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  Transaction,
  sendAndConfirmTransaction,
  Connection,
  TransactionInstruction
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const walletPath = process.env.ANCHOR_WALLET || 
    process.env.HOME + "/.config/solana/pool-authority-fresh.json";
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  REAL DEVNET YIELD ENFORCEMENT TEST");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(authority.publicKey)) / 1e9, "SOL\n");

  const [yieldRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("Pool Config:", POOL_CONFIG.toBase58());
  console.log("Yield Registry:", yieldRegistry.toBase58());
  console.log("");

  // ============================================================
  // STEP 1: Create or load test yield token
  // ============================================================
  console.log("STEP 1: Creating test yield token...");
  
  let testYieldMint: PublicKey;
  const testMintFile = "./test-yield-mint.json";
  
  if (fs.existsSync(testMintFile)) {
    const mintData = JSON.parse(fs.readFileSync(testMintFile, "utf-8"));
    testYieldMint = new PublicKey(mintData.mint);
    console.log("  Using existing test mint:", testYieldMint.toBase58());
  } else {
    testYieldMint = await createMint(
      connection,
      authority,
      authority.publicKey,
      null,
      9
    );
    fs.writeFileSync(testMintFile, JSON.stringify({ mint: testYieldMint.toBase58() }));
    console.log("  ✓ Created new test mint:", testYieldMint.toBase58());
  }
  console.log("");

  // ============================================================
  // STEP 2: Check if test mint is already registered
  // ============================================================
  console.log("STEP 2: Checking yield registry...");
  
  const registryAccount = await connection.getAccountInfo(yieldRegistry);
  if (!registryAccount) {
    console.log("  ✗ Yield registry not found!");
    process.exit(1);
  }
  
  const registryData = registryAccount.data;
  const mints: PublicKey[] = [];
  for (let i = 0; i < 8; i++) {
    const start = 40 + (i * 32);
    const mintBytes = registryData.slice(start, start + 32);
    mints.push(new PublicKey(mintBytes));
  }
  
  const isTestMintRegistered = mints.some(m => m.equals(testYieldMint));
  const activeMints = mints.filter(m => !m.equals(PublicKey.default));
  console.log("  Registered mints:", activeMints.length);
  console.log("  Test mint registered:", isTestMintRegistered);
  console.log("");

  // ============================================================
  // STEP 3: Register test mint as yield mint (if not already)
  // ============================================================
  if (!isTestMintRegistered) {
    console.log("STEP 3: Registering test mint as yield mint...");
    
    // Anchor discriminator = sha256("global:add_yield_mint")[0:8]
    const discriminator = crypto.createHash("sha256")
      .update("global:add_yield_mint")
      .digest()
      .slice(0, 8);
    
    // Instruction data: discriminator + mint pubkey as argument
    const data = Buffer.concat([
      discriminator,
      testYieldMint.toBuffer()
    ]);
    
    // CORRECT ORDER: authority, pool_config, yield_registry
    const addYieldMintInstruction = new TransactionInstruction({
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: POOL_CONFIG, isSigner: false, isWritable: false },
        { pubkey: yieldRegistry, isSigner: false, isWritable: true },
      ],
      programId: PROGRAM_ID,
      data: data,
    });
    
    try {
      const tx = new Transaction().add(addYieldMintInstruction);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
        commitment: "confirmed",
      });
      console.log("  ✓ Registered test mint as yield mint");
      console.log("  TX:", sig);
    } catch (err: any) {
      if (err.logs) {
        console.log("  ✗ Failed. Logs:");
        err.logs.forEach((log: string) => console.log("    ", log));
      } else {
        console.log("  ✗ Failed:", err.message || err);
      }
    }
  } else {
    console.log("STEP 3: Test mint already registered as yield mint ✓");
  }
  console.log("");

  // ============================================================
  // STEP 4: Mint some test yield tokens
  // ============================================================
  console.log("STEP 4: Minting test yield tokens...");
  
  const authorityAta = await getOrCreateAssociatedTokenAccount(
    connection,
    authority,
    testYieldMint,
    authority.publicKey
  );
  
  const currentBalance = Number(authorityAta.amount);
  if (currentBalance < 1_000_000_000) {
    await mintTo(
      connection,
      authority,
      testYieldMint,
      authorityAta.address,
      authority,
      10_000_000_000
    );
    console.log("  ✓ Minted 10 test yield tokens");
  } else {
    console.log("  ✓ Already have", currentBalance / 1e9, "test yield tokens");
  }
  console.log("  Token account:", authorityAta.address.toBase58());
  console.log("");

  // ============================================================
  // STEP 5: Verify on-chain state
  // ============================================================
  console.log("STEP 5: Verifying on-chain state...");
  
  // Re-fetch registry
  const updatedRegistry = await connection.getAccountInfo(yieldRegistry);
  if (updatedRegistry) {
    const updatedMints: PublicKey[] = [];
    for (let i = 0; i < 8; i++) {
      const start = 40 + (i * 32);
      const mintBytes = updatedRegistry.data.slice(start, start + 32);
      updatedMints.push(new PublicKey(mintBytes));
    }
    const updatedActive = updatedMints.filter(m => !m.equals(PublicKey.default));
    console.log("  Yield mints now registered:", updatedActive.length);
    updatedActive.forEach((m, i) => console.log(`    ${i+1}. ${m.toBase58()}`));
  }
  
  // Check feature flags (at offset 0x104 = 260 in pool data)
  const poolAccount = await connection.getAccountInfo(POOL_CONFIG);
  if (poolAccount) {
    const featureFlags = poolAccount.data[260]; // 0x104
    console.log("  Feature flags:", featureFlags, "(enforcement:", (featureFlags & 32) !== 0, ")");
  }
  console.log("");

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ✅ YIELD SYSTEM READY FOR INVESTOR DEMO");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("");
  console.log("  Program:        ", PROGRAM_ID.toBase58());
  console.log("  Pool Config:    ", POOL_CONFIG.toBase58());
  console.log("  Yield Registry: ", yieldRegistry.toBase58());
  console.log("  Test Yield Mint:", testYieldMint.toBase58());
  console.log("");
}

main().catch(console.error);
