/**
 * The White Protocol v2 Pool Setup - FINAL VERSION
 * 
 * This script:
 * 1. Initializes pool + merkle tree + pending buffer
 * 2. Registers wSOL asset
 * 3. Uploads ALL VKs with CORRECT G2 encoding (c1 before c0)
 * 4. Does NOT lock VKs (lock manually after testing withdraw)
 * 5. Outputs all addresses for config updates
 */
import * as anchor from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram 
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// =============================================================================
// CONFIGURATION
// =============================================================================
const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const WRAPPED_SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TREE_DEPTH = 20;
const ROOT_HISTORY_SIZE = 100;

// =============================================================================
// ENCODING FUNCTIONS - CRITICAL: CORRECT G2 ENCODING
// =============================================================================

function decimalToBytes32BE(decimal: string): number[] {
  const bn = BigInt(decimal);
  const hex = bn.toString(16).padStart(64, "0");
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function g1ToBytes(point: string[]): number[] {
  return [...decimalToBytes32BE(point[0]), ...decimalToBytes32BE(point[1])];
}

/**
 * CRITICAL: Correct G2 encoding for Solana alt_bn128
 * 
 * snarkjs format: [[x_c0, x_c1], [y_c0, y_c1]] where c0=real, c1=imaginary
 * Solana expects: x_c1 || x_c0 || y_c1 || y_c0 (IMAGINARY FIRST)
 */
function g2ToBytes(point: string[][]): number[] {
  const x_c0 = decimalToBytes32BE(point[0][0]); // real
  const x_c1 = decimalToBytes32BE(point[0][1]); // imaginary
  const y_c0 = decimalToBytes32BE(point[1][0]); // real
  const y_c1 = decimalToBytes32BE(point[1][1]); // imaginary
  
  // CORRECT ORDER: imaginary (c1) FIRST, then real (c0)
  return [...x_c1, ...x_c0, ...y_c1, ...y_c0];
}

function computeAssetId(mint: PublicKey, poolConfig: PublicKey): Buffer {
  const data = Buffer.concat([
    Buffer.from("asset_id"),
    mint.toBuffer(),
    poolConfig.toBuffer()
  ]);
  return crypto.createHash("sha256").update(data).digest();
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         The White Protocol v2 Pool Setup - FINAL VERSION (v8)              ║");
  console.log("║         With CORRECT G2 encoding for VKs                     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Load authority
  const walletPath = process.env.ANCHOR_WALLET || ".keys/pool-authority-v8.json";
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );

  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log("Authority:", authority.publicKey.toBase58());
  const balance = await connection.getBalance(authority.publicKey);
  console.log("Balance:", balance / 1e9, "SOL\n");

  if (balance < 2 * 1e9) {
    console.error("❌ Need at least 2 SOL");
    process.exit(1);
  }

  // ==========================================================================
  // STEP 1: Initialize Pool + Merkle Tree
  // ==========================================================================
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("STEP 1: Initialize Pool + Merkle Tree");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Derive PDAs
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_v2"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_v2"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending_v2"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), poolConfig.toBuffer()],
    PROGRAM_ID
  );

  console.log("Pool Config:", poolConfig.toBase58());
  console.log("Merkle Tree:", merkleTree.toBase58());
  console.log("Pending Buffer:", pendingBuffer.toBase58());

  // Check if pool exists
  const existingPool = await connection.getAccountInfo(poolConfig);
  if (existingPool) {
    console.log("\n⚠️  Pool already exists! Using existing pool.\n");
  } else {
    console.log("\nInitializing pool...");
    
    const ix = await program.methods
      .initializePoolV2(TREE_DEPTH, ROOT_HISTORY_SIZE)
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        merkleTree,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ Pool initialized:", sig);
    await sleep(2000);
  }

  // Initialize pending buffer
  const existingBuffer = await connection.getAccountInfo(pendingBuffer);
  if (!existingBuffer) {
    console.log("Initializing pending buffer...");
    
    const ix = await program.methods
      .initializePendingDepositsBuffer()
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        pendingBuffer,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ Pending buffer initialized:", sig);
    await sleep(1000);
  } else {
    console.log("✅ Pending buffer already exists");
  }

  // Initialize relayer registry
  const existingRegistry = await connection.getAccountInfo(relayerRegistry);
  if (!existingRegistry) {
    console.log("Initializing relayer registry...");
    
    try {
      const ix = await program.methods
        .initializePoolRegistries()
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig,
          relayerRegistry,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
      console.log("✅ Relayer registry initialized:", sig);
      await sleep(1000);
    } catch (e: any) {
      console.log("⚠️  Relayer registry:", e.message?.slice(0, 50));
    }
  } else {
    console.log("✅ Relayer registry already exists");
  }

  // ==========================================================================
  // STEP 2: Register wSOL Asset
  // ==========================================================================
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("STEP 2: Register wSOL Asset");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const assetId = computeAssetId(WRAPPED_SOL_MINT, poolConfig);
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_v2"), poolConfig.toBuffer(), assetId],
    PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), assetVault.toBuffer()],
    PROGRAM_ID
  );

  console.log("Asset ID:", assetId.toString("hex"));
  console.log("Asset Vault:", assetVault.toBase58());

  const existingVault = await connection.getAccountInfo(assetVault);
  if (!existingVault) {
    console.log("Registering wSOL...");
    
    const ix = await program.methods
      .registerAsset(Array.from(assetId))
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        assetVault,
        mint: WRAPPED_SOL_MINT,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction();

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ wSOL registered:", sig);
    await sleep(1000);
  } else {
    console.log("✅ wSOL already registered");
  }

  // ==========================================================================
  // STEP 3: Upload Verification Keys (WITH CORRECT G2 ENCODING)
  // ==========================================================================
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("STEP 3: Upload Verification Keys (CORRECT G2 encoding)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const vkConfigs = [
    { name: "deposit", seed: "vk_deposit", file: "deposit_vk.json", proofType: { deposit: {} }, icCount: 4 },
    { name: "withdraw", seed: "vk_withdraw", file: "withdraw_vk.json", proofType: { withdraw: {} }, icCount: 9 },
    { name: "withdraw_v2", seed: "vk_withdraw_v2", file: "withdraw_v2_vk.json", proofType: { withdrawV2: {} }, icCount: 13 },
  ];

  for (const config of vkConfigs) {
    console.log(`\n--- ${config.name.toUpperCase()} VK ---`);
    
    const vkPath = path.join("circuits/build", config.file);
    if (!fs.existsSync(vkPath)) {
      console.log(`⚠️  ${config.file} not found, skipping`);
      continue;
    }

    const vkJson = JSON.parse(fs.readFileSync(vkPath, "utf8"));
    
    const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
    const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
    const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
    const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
    const icPoints = vkJson.IC.map((ic: string[]) => Array.from(Buffer.from(g1ToBytes(ic))));

    // Verify G2 encoding
    const expectedC1Start = BigInt(vkJson.vk_beta_2[0][1]).toString(16).padStart(64, "0").slice(0, 8);
    const actualStart = Buffer.from(betaG2.slice(0, 4)).toString("hex");
    console.log(`  G2 encoding check: expected ${expectedC1Start}, got ${actualStart}`);
    
    const [vkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(config.seed), poolConfig.toBuffer()],
      PROGRAM_ID
    );
    console.log(`  VK PDA: ${vkPda.toBase58()}`);
    console.log(`  IC points: ${icPoints.length}`);

    // Check if VK exists and is locked
    const existingVk = await connection.getAccountInfo(vkPda);
    if (existingVk) {
      // Check is_locked flag (offset 42 in account data)
      const isLocked = existingVk.data[42] === 1;
      if (isLocked) {
        console.log(`  ⚠️  VK is LOCKED, cannot modify`);
        continue;
      }
      console.log(`  VK exists, will reinitialize`);
    }

    // Initialize VK
    try {
      console.log(`  Initializing...`);
      const ix = await program.methods
        .initializeVkV2(config.proofType, alphaG1, betaG2, gammaG2, deltaG2, config.icCount)
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig,
          vkAccount: vkPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ix
      );
      const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
      console.log(`  ✅ Init TX: ${sig.slice(0, 20)}...`);
      await sleep(1500);
    } catch (e: any) {
      console.log(`  ⚠️  Init: ${e.message?.slice(0, 60)}`);
    }

    // Upload IC points in chunks
    console.log(`  Uploading ${icPoints.length} IC points...`);
    for (let i = 0; i < icPoints.length; i += 4) {
      const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
      try {
        const ix = await program.methods
          .appendVkIcV2(config.proofType, chunk)
          .accountsStrict({
            authority: authority.publicKey,
            poolConfig,
            vkAccount: vkPda,
          })
          .instruction();

        const tx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
          ix
        );
        const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
        console.log(`    IC ${i}-${i + chunk.length - 1}: ${sig.slice(0, 15)}...`);
        await sleep(1000);
      } catch (e: any) {
        if (e.message?.includes("IcAlreadyComplete")) {
          console.log(`    IC already complete`);
          break;
        }
        console.log(`    ⚠️  ${e.message?.slice(0, 50)}`);
      }
    }

    // Finalize VK (but DO NOT LOCK)
    try {
      const ix = await program.methods
        .finalizeVkV2(config.proofType)
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig,
          vkAccount: vkPda,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
      console.log(`  ✅ Finalized: ${sig.slice(0, 20)}...`);
    } catch (e: any) {
      console.log(`  ⚠️  Finalize: ${e.message?.slice(0, 50)}`);
    }
  }

  // ==========================================================================
  // FINAL OUTPUT
  // ==========================================================================
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    SETUP COMPLETE!                           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  console.log("=== ADDRESSES FOR CONFIG FILES ===\n");
  
  console.log("// For Replit config.ts and relayer:");
  console.log(`POOL_CONFIG: "${poolConfig.toBase58()}",`);
  console.log(`MERKLE_TREE: "${merkleTree.toBase58()}",`);
  console.log(`PENDING_BUFFER: "${pendingBuffer.toBase58()}",`);
  console.log(`PROGRAM_ID: "${PROGRAM_ID.toBase58()}",`);
  console.log(`AUTHORITY: "${authority.publicKey.toBase58()}",`);
  
  console.log("\n// Asset info:");
  console.log(`WSOL_ASSET_ID: "${assetId.toString("hex")}",`);
  console.log(`WSOL_VAULT: "${assetVault.toBase58()}",`);
  
  console.log("\n// Sequencer state reset (data/tree-state.json):");
  console.log(JSON.stringify({
    root: "21663839004416932945382355908790599225266501822907911457504978515578255421292",
    leaves: [],
    nextLeafIndex: 0,
    savedAt: new Date().toISOString()
  }, null, 2));

  console.log("\n⚠️  IMPORTANT: VKs are NOT locked!");
  console.log("   Test deposit AND withdraw_v2 before locking.");
  console.log("   Run 'npx ts-node scripts/lock-vks.ts' after testing.\n");
}

main().catch(err => {
  console.error("❌ Error:", err);
  process.exit(1);
});
