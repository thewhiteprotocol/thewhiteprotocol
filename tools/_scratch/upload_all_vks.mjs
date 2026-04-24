import fs from "fs";
import path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const ROOT = process.cwd();
const PROGRAM_ID = new PublicKey("DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk");
const POOL_CONFIG = new PublicKey("5tiLj9YYhsc28h1JVVBBeUmUKmwTEUEnzn7q86NNso6q");
const RPC = "https://api.devnet.solana.com";
const WALLET_PATH = "/home/codespace/.config/solana/id.json";
const IDL_PATH = path.join(ROOT, "chains/solana/target/idl/white_protocol.json");

function decimalToBytes32BE(decimal) {
  const bn = BigInt(decimal);
  const hex = bn.toString(16).padStart(64, "0");
  return Array.from(Buffer.from(hex, "hex"));
}

function g1ToBytes(point) {
  return [...decimalToBytes32BE(point[0]), ...decimalToBytes32BE(point[1])];
}

function g2ToBytes(point) {
  const x0 = decimalToBytes32BE(point[0][0]);
  const x1 = decimalToBytes32BE(point[0][1]);
  const y0 = decimalToBytes32BE(point[1][0]);
  const y1 = decimalToBytes32BE(point[1][1]);
  return [...x1, ...x0, ...y1, ...y0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const VK_CONFIGS = [
  {
    name: "deposit",
    proofType: { deposit: {} },
    seed: "vk_deposit",
    path: path.join(ROOT, "circuits/deposit/build/deposit_vk.json"),
  },
  {
    name: "withdraw",
    proofType: { withdraw: {} },
    seed: "vk_withdraw",
    path: path.join(ROOT, "circuits/withdraw/build/withdraw_vk.json"),
  },
  {
    name: "merkle_batch_update",
    proofType: { merkleBatchUpdate: {} },
    seed: "vk_merkle_batch",
    path: path.join(ROOT, "circuits/merkle_batch_update/build/merkle_batch_update_vk.json"),
  },
];

async function uploadVk(connection, authority, program, config) {
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from(config.seed), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );

  console.log(`\n--- Uploading ${config.name} VK ---`);
  console.log("VK PDA:", vkPda.toBase58());

  try {
    const existing = await program.account.verificationKeyAccount.fetch(vkPda);
    if (existing.isInitialized) {
      console.log(`${config.name} VK already initialized, skipping`);
      return;
    }
  } catch (_) {
    // Not initialized yet.
  }

  if (!fs.existsSync(config.path)) {
    console.log(`VK file not found: ${config.path}, skipping`);
    return;
  }

  const vkJson = JSON.parse(fs.readFileSync(config.path, "utf8"));

  const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
  const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
  const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
  const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
  const icPoints = vkJson.IC.map((point) => Array.from(Buffer.from(g1ToBytes(point))));

  const initIx = await program.methods
    .initializeVkV2(config.proofType, alphaG1, betaG2, gammaG2, deltaG2, icPoints.length)
    .accountsStrict({
      authority: authority.publicKey,
      poolConfig: POOL_CONFIG,
      vkAccount: vkPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const initTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    initIx,
  );
  const initSig = await sendAndConfirmTransaction(connection, initTx, [authority], {
    commitment: "confirmed",
  });
  console.log("init tx:", initSig);
  await sleep(1500);

  for (let i = 0; i < icPoints.length; i += 4) {
    const chunk = icPoints.slice(i, i + 4);
    const appendIx = await program.methods
      .appendVkIcV2(config.proofType, chunk)
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .instruction();

    const appendTx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
      appendIx,
    );
    const appendSig = await sendAndConfirmTransaction(connection, appendTx, [authority], {
      commitment: "confirmed",
    });
    console.log(`append ${i}-${i + chunk.length - 1}:`, appendSig);
    await sleep(1000);
  }

  const finalizeIx = await program.methods
    .finalizeVkV2(config.proofType)
    .accountsStrict({
      authority: authority.publicKey,
      poolConfig: POOL_CONFIG,
      vkAccount: vkPda,
    })
    .instruction();
  const finalizeTx = new Transaction().add(finalizeIx);
  const finalizeSig = await sendAndConfirmTransaction(connection, finalizeTx, [authority], {
    commitment: "confirmed",
  });
  console.log("finalize tx:", finalizeSig);

  const uploaded = await program.account.verificationKeyAccount.fetch(vkPda);
  console.log(`${config.name} VK: isInitialized=${uploaded.isInitialized}, isLocked=${uploaded.isLocked}, icLen=${uploaded.vkIc.length}`);
}

async function main() {
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))),
  );
  const connection = new anchor.web3.Connection(RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(IDL_PATH, "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Pool Config:", POOL_CONFIG.toBase58());

  for (const config of VK_CONFIGS) {
    await uploadVk(connection, authority, program, config);
  }

  console.log("\n✅ All VK uploads complete!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
