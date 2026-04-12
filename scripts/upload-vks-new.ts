/**
 * Upload ALL Verification Keys - New Deployment
 * Program ID: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram, Keypair } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

const VK_CONFIGS = [
  { name: "deposit", path: "circuits/build/deposit_vk.json", seed: "vk_deposit", proofType: { deposit: {} } },
  { name: "withdraw", path: "circuits/build/withdraw_vk.json", seed: "vk_withdraw", proofType: { withdraw: {} } },
  { name: "membership", path: "circuits/build/membership_vk.json", seed: "vk_membership", proofType: { membership: {} } },
];

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
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("           Uploading Verification Keys");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Authority:", authority.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());

  for (const config of VK_CONFIGS) {
    console.log(`\n═══ Uploading ${config.name} VK ═══`);
    
    if (!fs.existsSync(config.path)) {
      console.log(`❌ VK file not found: ${config.path}`);
      continue;
    }

    const vkJson = JSON.parse(fs.readFileSync(config.path, "utf8"));
    console.log(`✓ Loaded VK: ${vkJson.nPublic} public inputs, ${vkJson.IC.length} IC points`);

    const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
    const betaG2 = g2ToBytes(vkJson.vk_beta_2);
    const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
    const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
    const icPoints = vkJson.IC.map((ic: string[]) => g1ToBytes(ic));

    const [vkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(config.seed), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    console.log(`VK PDA: ${vkPda.toBase58()}`);

    try {
      // Initialize VK
      const tx1 = await (program.methods as any)
        .initializeVkV2(config.proofType, alphaG1, betaG2, gammaG2, deltaG2, icPoints.length)
        .accounts({
          authority: authority,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
          systemProgram: SystemProgram.programId,
        })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
        .rpc();
      console.log(`  ✅ VK initialized: ${tx1.slice(0, 30)}...`);

      // Append IC points in chunks
      for (let i = 0; i < icPoints.length; i += 4) {
        const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
        const tx2 = await (program.methods as any)
          .appendVkIcV2(config.proofType, chunk)
          .accounts({
            authority: authority,
            poolConfig: POOL_CONFIG,
            vkAccount: vkPda,
          })
          .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
          .rpc();
        console.log(`  ✅ IC chunk ${i / 4 + 1}/${Math.ceil(icPoints.length / 4)}: ${tx2.slice(0, 30)}...`);
      }

      // Finalize VK
      const tx3 = await (program.methods as any)
        .finalizeVkV2(config.proofType)
        .accounts({
          authority: authority,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
        })
        .rpc();
      console.log(`  ✅ VK finalized: ${tx3.slice(0, 30)}...`);

    } catch (e: any) {
      console.error(`  Error: ${e.message?.slice(0, 200) || e}`);
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                    VK Upload Complete!");
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch(console.error);
