import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Program ID: env var override for localnet keypair mismatch, otherwise canonical from IDL
const idlPath = process.env.IDL_PATH || "target/idl/white_protocol.json";
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || idl.address);

const keypairPath = process.env.ANCHOR_WALLET || "/workspaces/thewhiteprotocol/devnet-deployer.json";
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
const [POOL_CONFIG] = PublicKey.findProgramAddressSync(
  [Buffer.from("white_pool"), authority.publicKey.toBuffer()],
  PROGRAM_ID
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function g1ToBytes(point: string[]): Buffer {
  const x = BigInt(point[0]).toString(16).padStart(64, "0");
  const y = BigInt(point[1]).toString(16).padStart(64, "0");
  return Buffer.from(x + y, "hex");
}

function g2ToBytes(point: string[][]): Buffer {
  const x_c0 = BigInt(point[0][0]).toString(16).padStart(64, "0");
  const x_c1 = BigInt(point[0][1]).toString(16).padStart(64, "0");
  const y_c0 = BigInt(point[1][0]).toString(16).padStart(64, "0");
  const y_c1 = BigInt(point[1][1]).toString(16).padStart(64, "0");
  return Buffer.from(x_c1 + x_c0 + y_c1 + y_c0, "hex");
}

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";
  const connection = new Connection(rpcUrl, "confirmed");
  const keypairPath = process.env.ANCHOR_WALLET || "/workspaces/thewhiteprotocol/devnet-deployer.json";
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))));
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Override IDL address so Anchor uses the correct program ID (e.g. localnet keypair)
  (idl as any).address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl, provider);

  const vkConfigs = [
    {
      name: "deposit",
      seed: "vk_deposit",
      file: "../../circuits/deposit/build/deposit_vk.json",
      proofType: { deposit: {} },
      icCount: 4,
    },
    {
      name: "withdraw",
      seed: "vk_withdraw",
      file: "../../circuits/withdraw/build/withdraw_vk.json",
      proofType: { withdraw: {} },
      icCount: 9,
    },
    {
      name: "withdraw_v2",
      seed: "vk_withdraw_v2",
      file: "../../circuits/withdraw_v2/build/withdraw_v2_vk.json",
      proofType: { withdrawV2: {} },
      icCount: 13,
    },
    {
      name: "merkle_batch_update",
      seed: "vk_merkle_batch",
      file: "../../circuits/merkle_batch_update/build/verification_key.json",
      proofType: { merkleBatchUpdate: {} },
      icCount: 6,
    },
  ];

  for (const config of vkConfigs) {
    console.log(`\n--- ${config.name.toUpperCase()} VK ---`);

    const vkPath = path.join(process.cwd(), config.file);
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

    const [vkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from(config.seed), POOL_CONFIG.toBuffer()],
      PROGRAM_ID
    );
    console.log(`  VK PDA: ${vkPda.toBase58()}`);
    console.log(`  IC points: ${icPoints.length}`);

    const existingVk = await connection.getAccountInfo(vkPda);
    if (existingVk) {
      const isLocked = existingVk.data[42] === 1;
      if (isLocked) {
        console.log(`  ⚠️  VK is LOCKED, skipping`);
        continue;
      }
      console.log(`  VK exists, reinitializing...`);
    }

    // Initialize VK
    try {
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
      console.log(`  ✅ Init TX: ${sig.slice(0, 20)}...`);
      await sleep(1000);
    } catch (e: any) {
      console.log(`  ❌ Init failed: ${e.message?.slice(0, 100) || e}`);
      continue;
    }

    // Append IC points in chunks
    const chunkSize = 3;
    for (let i = 0; i < icPoints.length; i += chunkSize) {
      const chunk = icPoints.slice(i, i + chunkSize);
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
        console.log(`  ✅ IC ${i}-${i + chunk.length - 1} TX: ${sig.slice(0, 16)}...`);
        await sleep(500);
      } catch (e: any) {
        console.log(`  ❌ IC ${i} failed: ${e.message?.slice(0, 100) || e}`);
      }
    }

    // Finalize VK
    try {
      const ix = await program.methods
        .finalizeVkV2(config.proofType)
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: POOL_CONFIG,
          vkAccount: vkPda,
        })
        .instruction();

      const tx = new Transaction().add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        ix
      );
      const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
      console.log(`  ✅ Finalize TX: ${sig.slice(0, 20)}...`);
    } catch (e: any) {
      console.log(`  ❌ Finalize failed: ${e.message?.slice(0, 100) || e}`);
    }
  }

  console.log("\n🎉 VK upload complete!");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
