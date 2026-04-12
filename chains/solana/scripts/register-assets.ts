import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, TransactionInstruction, ComputeBudgetProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as crypto from "crypto";
const keccak256 = require("js-sha3").keccak256;

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey(process.env.POOL_CONFIG || "iWMNRMHKS6zFKaNX1WkCBD3vsdnW4L24qd5Cp7sgLRV");

const ASSETS = [
  { name: "wSOL", mint: "So11111111111111111111111111111111111111112" },
  { name: "USDC", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
];

// CORRECT canonical asset_id derivation:
// asset_id = 0x00 || Keccak256("white:asset_id:v1" || mint)[0..31]
function computeAssetId(mint: PublicKey): Buffer {
  const prefix = Buffer.from("white:asset_id:v1");
  const combined = Buffer.concat([prefix, mint.toBuffer()]);
  const hash = Buffer.from(keccak256.arrayBuffer(combined)); // 32 bytes

  const out = Buffer.alloc(32);
  out[0] = 0x00; // First byte is always 0
  hash.copy(out, 1, 0, 31); // Copy first 31 bytes of hash to positions 1-31
  return out;
}

// Get discriminator
const REGISTER_ASSET_DISCRIMINATOR = crypto.createHash("sha256")
  .update("global:register_asset")
  .digest()
  .slice(0, 8);

async function main() {
  const connection = new Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  console.log("Authority:", authority.publicKey.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());
  console.log("\n🔧 Registering assets with CANONICAL asset_id derivation...\n");

  for (const asset of ASSETS) {
    const mint = new PublicKey(asset.mint);
    const assetId = computeAssetId(mint);
    
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_v2"), POOL_CONFIG.toBuffer(), assetId],
      PROGRAM_ID
    );
    
    const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token"), assetVault.toBuffer()],
      PROGRAM_ID
    );

    console.log(`📦 ${asset.name}:`);
    console.log(`   Mint: ${mint.toString()}`);
    console.log(`   Asset ID (canonical): ${assetId.toString("hex")}`);
    console.log(`   Asset ID first byte: ${assetId[0]} (should be 0)`);
    console.log(`   Vault: ${assetVault.toString()}`);
    console.log(`   Vault Token: ${vaultTokenAccount.toString()}`);

    const vaultAccount = await connection.getAccountInfo(assetVault);
    if (vaultAccount) {
      console.log(`   ✅ Already registered!\n`);
      continue;
    }

    // Build raw instruction: discriminator (8) + asset_id (32)
    const data = Buffer.concat([REGISTER_ASSET_DISCRIMINATOR, assetId]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: authority.publicKey, isSigner: true, isWritable: true },
        { pubkey: POOL_CONFIG, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: assetVault, isSigner: false, isWritable: true },
        { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }))
      .add(ix);

    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
      console.log(`   ✅ Registered! TX: ${sig}\n`);
    } catch (e: any) {
      console.log(`   ❌ Failed: ${e.message}`);
      if (e.logs) {
        e.logs.slice(-5).forEach((l: string) => console.log(`      ${l}`));
      }
      console.log();
    }
  }

  console.log("✅ Done!");
}

main().catch(console.error);
