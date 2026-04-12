/**
 * Upload MerkleBatchUpdate Verification Key
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

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
  // G1 point: [x, y, 1] -> 64 bytes (x || y)
  return [...decimalToBytes32BE(point[0]), ...decimalToBytes32BE(point[1])];
}

function g2ToBytes(point: string[][]): number[] {
  // G2 point format in snarkjs VK: [[x_c0, x_c1], [y_c0, y_c1], [1, 0]]
  // For BN254: x = x_c1 * u + x_c0, y = y_c1 * u + y_c0
  // Encoding: x_c1 || x_c0 || y_c1 || y_c0 (all 32 bytes, big-endian)
  const x_c0 = decimalToBytes32BE(point[0][0]);
  const x_c1 = decimalToBytes32BE(point[0][1]);
  const y_c0 = decimalToBytes32BE(point[1][0]);
  const y_c1 = decimalToBytes32BE(point[1][1]);
  // Note: Order matches groth16.rs encoding
  return [...x_c1, ...x_c0, ...y_c1, ...y_c0];
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  // Load VK
  const vkPath = "circuits/build/merkle_batch_update/verification_key.json";
  const vkJson: VKJson = JSON.parse(fs.readFileSync(vkPath, "utf8"));
  
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Uploading MerkleBatchUpdate VK");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Authority:", authority.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());
  console.log("Public inputs:", vkJson.nPublic);
  console.log("IC points:", vkJson.IC.length);

  // Derive VK PDA
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log("VK PDA:", vkPda.toString());

  try {
    // Convert VK data
    console.log("\nConverting VK data...");
    const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
    console.log("  alpha_g1:", alphaG1.length, "bytes");
    
    const betaG2 = g2ToBytes(vkJson.vk_beta_2);
    console.log("  beta_g2:", betaG2.length, "bytes");
    
    const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
    console.log("  gamma_g2:", gammaG2.length, "bytes");
    
    const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
    console.log("  delta_g2:", deltaG2.length, "bytes");
    
    const icPoints = vkJson.IC.map((ic) => g1ToBytes(ic));
    console.log("  IC points:", icPoints.length, "x", icPoints[0].length, "bytes");

    console.log("\n🚀 Uploading VK...");

    // Initialize VK
    const tx1 = await (program.methods as any)
      .initializeVkV2({ merkleBatchUpdate: {} }, alphaG1, betaG2, gammaG2, deltaG2, icPoints.length)
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
      .rpc();
    console.log("  ✅ VK initialized:", tx1.slice(0, 30));

    // Upload IC points in chunks
    for (let i = 0; i < icPoints.length; i += 4) {
      const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
      const tx2 = await (program.methods as any)
        .appendVkIcV2({ merkleBatchUpdate: {} }, chunk)
        .accounts({
          authority: authority,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
        .rpc();
      console.log(`  ✅ IC chunk ${Math.floor(i / 4) + 1}/${Math.ceil(icPoints.length / 4)}:`, tx2.slice(0, 30));
    }

    // Finalize VK
    const tx3 = await (program.methods as any)
      .finalizeVkV2({ merkleBatchUpdate: {} })
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .rpc();
    console.log("  ✅ VK finalized:", tx3.slice(0, 30));

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  MerkleBatchUpdate VK Upload Complete!");
    console.log("═══════════════════════════════════════════════════════════════");
  } catch (e: any) {
    console.error("\n❌ Error:", e.message);
    if (e.logs) console.error("Logs:", e.logs.slice(-5));
    throw e;
  }
}

main().catch(console.error);
