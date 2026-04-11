/**
 * Setup Pool Registries - FIXED ASSET ID COMPUTATION
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT } from "@solana/spl-token";
import { createHash } from "crypto";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

// Compute asset_id matching Rust: 0x00 || keccak256("white:asset_id:v1" || mint)[0..31]
function computeAssetId(mint: PublicKey): Buffer {
  const prefix = Buffer.from("white:asset_id:v1");
  const mintBytes = mint.toBuffer();
  const combined = Buffer.concat([prefix, mintBytes]);
  
  // Use keccak256 from js-sha3
  const keccak = require("js-sha3").keccak256;
  const hash = Buffer.from(keccak(combined), "hex");
  
  // asset_id = 0x00 || hash[0..31]
  const assetId = Buffer.alloc(32);
  assetId[0] = 0x00;
  hash.copy(assetId, 1, 0, 31);
  
  return assetId;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("      Setup Pool Registries - FIXED ASSET ID                   ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log("Authority:", authority.publicKey.toString());
  console.log("Pool:", POOL_CONFIG.toString());

  // Compute correct asset ID for wrapped SOL
  const SOL_ASSET_ID = computeAssetId(NATIVE_MINT);
  console.log("NATIVE_MINT:", NATIVE_MINT.toString());
  console.log("SOL Asset ID:", SOL_ASSET_ID.toString("hex"));

  // PDAs
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [complianceConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_v2"), POOL_CONFIG.toBuffer(), SOL_ASSET_ID],
    PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), assetVault.toBuffer()],
    PROGRAM_ID
  );
  const [relayerNode] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_node"), POOL_CONFIG.toBuffer(), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log("\nPDAs:");
  console.log("  Asset Vault:", assetVault.toString());
  console.log("  Vault Token:", vaultTokenAccount.toString());
  console.log("  Relayer Node:", relayerNode.toString());

  // Step 1: Check registries (already done)
  console.log("\n--- Step 1: Check Registries ---");
  const regInfo = await connection.getAccountInfo(relayerRegistry);
  console.log("Relayer Registry:", regInfo ? "✅" : "❌");
  
  const compInfo = await connection.getAccountInfo(complianceConfig);
  console.log("Compliance Config:", compInfo ? "✅" : "❌");

  // Step 2: Register SOL Asset
  console.log("\n--- Step 2: Register SOL Asset ---");
  const vaultInfo = await connection.getAccountInfo(assetVault);
  
  if (vaultInfo) {
    console.log("✓ SOL asset already registered");
  } else {
    try {
      const ix = await program.methods
        .registerAsset(Array.from(SOL_ASSET_ID))
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: POOL_CONFIG,
          mint: NATIVE_MINT,
          assetVault: assetVault,
          vaultTokenAccount: vaultTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
      tx.add(ix);
      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
      console.log("✓ SOL asset registered:", sig.slice(0, 40) + "...");
    } catch (e: any) {
      console.log("❌ Asset registration:", e.message?.slice(0, 100));
      if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("  ", l));
    }
  }

  // Step 3: Register Relayer
  console.log("\n--- Step 3: Register Test Relayer ---");
  const relayerInfo = await connection.getAccountInfo(relayerNode);
  
  if (relayerInfo) {
    console.log("✓ Relayer already registered");
  } else {
    try {
      const ix = await program.methods
        .registerRelayer(100, "")
        .accountsStrict({
          operator: authority.publicKey,
          poolConfig: POOL_CONFIG,
          relayerRegistry: relayerRegistry,
          relayerNode: relayerNode,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
      tx.add(ix);
      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
      console.log("✓ Relayer registered:", sig.slice(0, 40) + "...");
    } catch (e: any) {
      console.log("❌ Relayer registration:", e.message?.slice(0, 100));
      if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("  ", l));
    }
  }

  // Final state
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                     FINAL STATE                               ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const checks: [string, PublicKey][] = [
    ["relayer_registry", relayerRegistry],
    ["compliance_config", complianceConfig],
    ["asset_vault (SOL)", assetVault],
    ["vault_token_account", vaultTokenAccount],
    ["relayer_node", relayerNode],
  ];

  for (const [name, pda] of checks) {
    const info = await connection.getAccountInfo(pda);
    console.log(`${name}: ${info ? "✅" : "❌"}`);
  }

  // Save asset ID for other scripts
  const configPath = "data/pool-config.json";
  const config = {
    poolConfig: POOL_CONFIG.toString(),
    solAssetId: SOL_ASSET_ID.toString("hex"),
    assetVault: assetVault.toString(),
    relayerNode: relayerNode.toString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`\n✓ Config saved to ${configPath}`);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
