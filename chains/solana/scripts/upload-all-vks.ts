/**
 * Upload ALL Verification Keys to Fresh Pool
 * Uses accountsStrict() to bypass Anchor's PDA auto-derivation
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram, Transaction, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey(process.env.POOL_CONFIG || "J92qBrNomkSQ6tjmjbh7rVk2T8R6e6yxkGbB7jQirRRX");

const VK_CONFIGS = [
  { name: "deposit", path: "circuits/build/deposit_vk.json", seed: "vk_deposit", proofType: { deposit: {} } },
  { name: "withdraw", path: "circuits/build/withdraw_vk.json", seed: "vk_withdraw", proofType: { withdraw: {} } },
  { name: "merkle_batch", path: "circuits/build/merkle_batch_update/verification_key.json", seed: "vk_merkle_batch", proofType: { merkleBatchUpdate: {} } },
];

interface VKJson {
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  IC: string[][];
  nPublic: number;
}

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

function g2ToBytes(point: string[][]): number[] {
  const x0 = decimalToBytes32BE(point[0][0]);
  const x1 = decimalToBytes32BE(point[0][1]);
  const y0 = decimalToBytes32BE(point[1][0]);
  const y1 = decimalToBytes32BE(point[1][1]);
  return [...x1, ...x0, ...y1, ...y0];
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function uploadVK(
  program: Program,
  authority: Keypair,
  connection: anchor.web3.Connection,
  config: typeof VK_CONFIGS[0]
): Promise<void> {
  console.log(`\n═══ Uploading ${config.name} VK ═══`);

  const vkPath = path.join(process.cwd(), config.path);
  if (!fs.existsSync(vkPath)) {
    console.log(`❌ VK file not found: ${vkPath}`);
    return;
  }

  const vkJson: VKJson = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  console.log(`✓ Loaded VK: ${vkJson.nPublic} public inputs, ${vkJson.IC.length} IC points`);

  const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
  const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
  const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
  const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
  const icPoints = vkJson.IC.map((ic) => Array.from(Buffer.from(g1ToBytes(ic))));

  // Derive VK PDA ourselves (Anchor can't auto-derive from enum arg)
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(config.seed), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log(`VK PDA: ${vkPda.toBase58()}`);

  const vkAccount = await connection.getAccountInfo(vkPda);

  if (vkAccount) {
    try {
      const vkData = await (program.account as any).verificationKeyAccountV2.fetch(vkPda);
      if (vkData.isValid) {
        console.log(`✓ VK already uploaded and valid!`);
        return;
      }
      console.log(`VK exists but not finalized, continuing...`);
    } catch (e) {
      console.log(`VK exists but parse failed, continuing...`);
    }
  }

  // Step 1: Initialize VK - use accountsStrict to bypass auto-derivation
  if (!vkAccount) {
    console.log(`Initializing VK account...`);
    try {
      const ix = await program.methods
        .initializeVkV2(
          config.proofType,
          alphaG1,
          betaG2,
          gammaG2,
          deltaG2,
          icPoints.length
        )
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
      tx.add(ix);
      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
      console.log(`✓ Init TX: ${sig}`);
      await sleep(2000);
    } catch (e: any) {
      if (e.message?.includes("already in use")) {
        console.log(`✓ Already initialized`);
      } else {
        console.log(`❌ Init error: ${e.message}`);
        throw e;
      }
    }
  }

  // Step 2: Upload IC points in chunks
  for (let i = 0; i < icPoints.length; i += 4) {
    const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
    console.log(`Uploading IC points ${i} to ${i + chunk.length - 1}...`);

    try {
      const ix = await program.methods
        .appendVkIcV2(config.proofType, chunk)
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
        })
        .instruction();

      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));
      tx.add(ix);
      tx.feePayer = authority.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
      console.log(`✓ Append TX: ${sig.slice(0, 20)}...`);
      await sleep(1000);
    } catch (e: any) {
      console.log(`⚠ Append failed: ${e.message}`);
    }
  }

  // Step 3: Finalize VK
  console.log(`Finalizing VK...`);
  try {
    const ix = await program.methods
      .finalizeVkV2(config.proofType)
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .instruction();

    const tx = new Transaction();
    tx.add(ix);
    tx.feePayer = authority.publicKey;
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
    console.log(`✓ Finalize TX: ${sig}`);
  } catch (e: any) {
    console.log(`⚠ Finalize: ${e.message}`);
  }

  console.log(`✅ ${config.name} VK complete!`);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("           Upload ALL Verification Keys to Fresh Pool          ");
  console.log("═══════════════════════════════════════════════════════════════");

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log(`\nAuthority: ${authority.publicKey.toString()}`);
  console.log(`Pool: ${POOL_CONFIG.toString()}`);

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  for (const config of VK_CONFIGS) {
    await uploadVK(program, authority, connection, config);
  }

  // Verification
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                     FINAL VERIFICATION                        ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const config of VK_CONFIGS) {
    const [vkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(config.seed), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );

    try {
      const vkData = await (program.account as any).verificationKeyAccountV2.fetch(vkPda);
      console.log(`${config.name}: ✅ Valid=${vkData.isValid}, IC=${vkData.vkIc?.length || 0} points`);
    } catch (e) {
      console.log(`${config.name}: ❌ Not found`);
    }
  }

  console.log("\n🎉 Done!");
}

main().catch((err) => {
  console.error("\n❌ Error:", err);
  process.exit(1);
});
