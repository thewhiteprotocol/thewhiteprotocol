/**
 * Upload Withdraw V2 Verification Key (ProofType::WithdrawV2 = 5)
 * Seed: vk_withdraw_v2
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram, Transaction, sendAndConfirmTransaction, Keypair } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");

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
  for (let i = 0; i < 64; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("       Upload WithdrawV2 VK (seed: vk_withdraw_v2)             ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log(`Authority: ${authority.publicKey}`);
  console.log(`Balance: ${(await connection.getBalance(authority.publicKey)) / 1e9} SOL\n`);

  // Load withdraw_v2 VK
  const vkJson: VKJson = JSON.parse(fs.readFileSync("circuits/build/withdraw_v2_vk.json", "utf8"));
  console.log(`Loaded VK: ${vkJson.nPublic} public inputs, ${vkJson.IC.length} IC points`);

  const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
  const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
  const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
  const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
  const icPoints = vkJson.IC.map(ic => Array.from(Buffer.from(g1ToBytes(ic))));

  // CORRECT SEED: vk_withdraw_v2 for ProofType::WithdrawV2
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw_v2"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log(`VK PDA: ${vkPda.toBase58()}`);

  const vkAccount = await connection.getAccountInfo(vkPda);
  if (vkAccount) {
    try {
      const vkData = await program.account.verificationKeyAccountV2.fetch(vkPda);
      if (vkData.isValid) {
        console.log(`\n✅ WithdrawV2 VK already valid! IC points: ${vkData.vkIc?.length}`);
        return;
      }
      console.log(`VK exists but not finalized, continuing...`);
    } catch (e) {
      console.log(`VK exists but unreadable, continuing...`);
    }
  }

  // Step 1: Initialize
  if (!vkAccount) {
    console.log(`\nStep 1: Initializing VK...`);
    const ix = await program.methods
      .initializeVkV2({ withdrawV2: {} }, alphaG1, betaG2, gammaG2, deltaG2, icPoints.length)
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`✓ Init TX: ${sig}`);
    await sleep(2000);
  }

  // Step 2: Upload IC points
  console.log(`\nStep 2: Uploading ${icPoints.length} IC points...`);
  for (let i = 0; i < icPoints.length; i += 4) {
    const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
    console.log(`  IC points ${i}-${i + chunk.length - 1}...`);
    
    const ix = await program.methods
      .appendVkIcV2({ withdrawV2: {} }, chunk)
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log(`  ✓ ${sig.slice(0, 20)}...`);
    await sleep(1000);
  }

  // Step 3: Finalize
  console.log(`\nStep 3: Finalizing...`);
  const ix = await program.methods
    .finalizeVkV2({ withdrawV2: {} })
    .accountsStrict({
      authority: authority.publicKey,
      poolConfig: POOL_CONFIG,
      vkAccount: vkPda,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log(`✓ Finalize TX: ${sig}`);

  // Verify
  const vkData = await program.account.verificationKeyAccountV2.fetch(vkPda);
  console.log(`\n✅ WithdrawV2 VK uploaded! Valid=${vkData.isValid}, IC=${vkData.vkIc?.length} points`);
}

main().catch(err => { console.error("❌", err); process.exit(1); });
