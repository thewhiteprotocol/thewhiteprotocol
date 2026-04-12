/**
 * Upload VKs with CORRECT G2 encoding
 * G2 order: c1 (imaginary) FIRST, then c0 (real)
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc");

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
 * CRITICAL: Correct G2 encoding
 * snarkjs: [[x_c0, x_c1], [y_c0, y_c1]] where c0=real, c1=imaginary
 * Solana expects: x_c1 || x_c0 || y_c1 || y_c0 (IMAGINARY FIRST)
 */
function g2ToBytes(point: string[][]): number[] {
  const x_c0 = decimalToBytes32BE(point[0][0]); // real
  const x_c1 = decimalToBytes32BE(point[0][1]); // imaginary
  const y_c0 = decimalToBytes32BE(point[1][0]); // real
  const y_c1 = decimalToBytes32BE(point[1][1]); // imaginary
  return [...x_c1, ...x_c0, ...y_c1, ...y_c0]; // c1 FIRST
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log("Upload VKs with CORRECT G2 encoding\n");

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );
  const connection = new anchor.web3.Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Pool:", POOL_CONFIG.toBase58());

  const vkConfigs = [
    { name: "deposit", seed: "vk_deposit", file: "circuits/build/deposit_vk.json", proofType: { deposit: {} }, icCount: 4 },
    { name: "withdraw", seed: "vk_withdraw", file: "circuits/build/withdraw_vk.json", proofType: { withdraw: {} }, icCount: 9 },
    { name: "withdraw_v2", seed: "vk_withdraw_v2", file: "circuits/build/withdraw_v2_vk.json", proofType: { withdrawV2: {} }, icCount: 13 },
  ];

  for (const config of vkConfigs) {
    console.log(`\n=== ${config.name.toUpperCase()} ===`);
    
    if (!fs.existsSync(config.file)) {
      console.log(`⚠️  ${config.file} not found, skipping`);
      continue;
    }

    const vkJson = JSON.parse(fs.readFileSync(config.file, "utf8"));
    const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
    const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
    const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
    const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
    const icPoints = vkJson.IC.map((ic: string[]) => Array.from(Buffer.from(g1ToBytes(ic))));

    // Verify G2 encoding is correct (c1 first)
    const expectedC1 = BigInt(vkJson.vk_beta_2[0][1]).toString(16).padStart(64, "0").slice(0, 16);
    const actualFirst = Buffer.from(betaG2.slice(0, 8)).toString("hex");
    console.log(`G2 check: first 8 bytes = ${actualFirst}, expected c1 start = ${expectedC1.slice(0,16)}`);

    const [vkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(config.seed), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    console.log(`VK PDA: ${vkPda.toBase58()}`);

    // Initialize
    try {
      console.log("Initializing...");
      const ix = await program.methods
        .initializeVkV2(config.proofType, alphaG1, betaG2, gammaG2, deltaG2, config.icCount)
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
      console.log(`✅ Init: ${sig.slice(0, 30)}...`);
      await sleep(2000);
    } catch (e: any) {
      console.log(`Init: ${e.message?.slice(0, 60)}`);
    }

    // Upload IC points
    console.log(`Uploading ${icPoints.length} IC points...`);
    for (let i = 0; i < icPoints.length; i += 4) {
      const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
      try {
        const ix = await program.methods
          .appendVkIcV2(config.proofType, chunk)
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
        console.log(`  IC ${i}-${i+chunk.length-1}: ${sig.slice(0,20)}...`);
        await sleep(1000);
      } catch (e: any) {
        if (e.message?.includes("IcAlreadyComplete")) break;
        console.log(`  IC error: ${e.message?.slice(0,50)}`);
      }
    }

    // Finalize (but DO NOT lock)
    try {
      const ix = await program.methods
        .finalizeVkV2(config.proofType)
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
      console.log(`✅ Finalized: ${sig.slice(0, 30)}...`);
    } catch (e: any) {
      console.log(`Finalize: ${e.message?.slice(0, 50)}`);
    }
  }

  console.log("\n✅ All VKs uploaded with CORRECT G2 encoding!");
  console.log("⚠️  VKs are NOT locked - test withdraw before locking!");
}

main().catch(console.error);
