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
const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const RPC = "https://api.devnet.solana.com";
const WALLET_PATH = "/home/codespace/.config/solana/id.json";
const VK_PATH = path.join(ROOT, "circuits/withdraw_v2/build/withdraw_v2_vk.json");
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
  const vkJson = JSON.parse(fs.readFileSync(VK_PATH, "utf8"));

  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw_v2"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );

  console.log("authority:", authority.publicKey.toBase58());
  console.log("vk pda:", vkPda.toBase58());

  try {
    const existing = await program.account.verificationKeyAccount.fetch(vkPda);
    if (existing.isInitialized) {
      console.log("withdraw_v2 VK already initialized");
      return;
    }
  } catch (_) {
    // Not initialized yet.
  }

  const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
  const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
  const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
  const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
  const icPoints = vkJson.IC.map((point) => Array.from(Buffer.from(g1ToBytes(point))));
  const proofType = { withdrawV2: {} };

  const initIx = await program.methods
    .initializeVkV2(proofType, alphaG1, betaG2, gammaG2, deltaG2, icPoints.length)
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
      .appendVkIcV2(proofType, chunk)
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
    .finalizeVkV2(proofType)
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
  console.log("isInitialized:", uploaded.isInitialized);
  console.log("isLocked:", uploaded.isLocked);
  console.log("icLen:", uploaded.vkIc.length);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
