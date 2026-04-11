/**
 * Upload Withdraw V2 Verification Key - Fixed version
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const VK_PATH = path.join(__dirname, "../circuits/build/withdraw_v2_vk.json");
const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("uUhux7yXzGuA1rCNBQyaTrWuEW6yYUUTSAFnDVaefqw");
const VK_SEED = Buffer.from("vk_withdraw_v2");

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

async function main() {
  // Check if VK file exists
  if (!fs.existsSync(VK_PATH)) {
    console.error("❌ Withdraw VK not found at:", VK_PATH);
    console.log("   Make sure withdraw circuit is compiled.");
    return;
  }

  const vkJson: VKJson = JSON.parse(fs.readFileSync(VK_PATH, "utf8"));
  console.log(`Loaded VK: ${vkJson.nPublic} public inputs, ${vkJson.IC.length} IC points`);

  const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
  const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
  const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
  const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
  const icPoints = vkJson.IC.map((ic) => Array.from(Buffer.from(g1ToBytes(ic))));

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new Program(idl, provider);

  const [vkPda] = PublicKey.findProgramAddressSync(
    [VK_SEED, POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log(`VK PDA: ${vkPda.toBase58()}`);

  const vkAccount = await provider.connection.getAccountInfo(vkPda);
  const proofTypeArg = { withdrawV2: {} };

  if (!vkAccount) {
    console.log("Initializing VK account...");
    const tx = await program.methods
      .initializeVkV2(
        proofTypeArg,
        alphaG1,
        betaG2,
        gammaG2,
        deltaG2,
        icPoints.length
      )
      .accountsStrict({
        authority: provider.wallet.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`Init tx: ${tx}`);
    await new Promise(r => setTimeout(r, 2000));
  } else {
    console.log("VK account already exists, skipping init");
  }

  // Upload IC points in chunks
  for (let i = 0; i < icPoints.length; i += 4) {
    const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
    console.log(`Uploading IC points ${i} to ${i + chunk.length - 1}...`);
    const tx = await program.methods
      .appendVkIcV2(proofTypeArg, chunk)
      .accountsStrict({
        authority: provider.wallet.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .rpc();
    console.log(`Append tx: ${tx}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Finalize
  console.log("Finalizing VK...");
  const tx = await program.methods
    .finalizeVkV2(proofTypeArg)
    .accountsStrict({
      authority: provider.wallet.publicKey,
      poolConfig: POOL_CONFIG,
      vkAccount: vkPda,
    })
    .rpc();
  console.log(`Finalize tx: ${tx}`);

  console.log("\n✅ Withdraw VK uploaded successfully!");
}

main().catch(console.error);
