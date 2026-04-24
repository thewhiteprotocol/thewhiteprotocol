import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk");
const POOL_CONFIG = new PublicKey("5tiLj9YYhsc28h1JVVBBeUmUKmwTEUEnzn7q86NNso6q");
const WALLET_PATH = "/home/codespace/.config/solana/id.json";
const ROOT = process.cwd();
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
  } catch (_) {}

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
  console.log(`${config.name} VK: isInitialized=${uploaded.isInitialized}, icLen=${uploaded.vkIc.length}`);
}

async function registerAsset(connection, authority, program, mint, assetIdHex, name) {
  console.log(`\n--- Registering ${name} ---`);
  const assetId = Buffer.from(assetIdHex, 'hex');
  const mintPubkey = new PublicKey(mint);

  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), POOL_CONFIG.toBuffer(), assetId],
    PROGRAM_ID,
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault_token'), assetVault.toBuffer()],
    PROGRAM_ID,
  );

  console.log('AssetVault:', assetVault.toBase58());
  console.log('VaultTokenAccount:', vaultTokenAccount.toBase58());

  try {
    const existing = await connection.getAccountInfo(assetVault);
    if (existing) {
      console.log(`${name} already registered, skipping`);
      return;
    }
  } catch (_) {}

  const disc = Buffer.alloc(8);
  const hash = crypto.createHash('sha256').update('global:register_asset').digest();
  hash.copy(disc, 0, 0, 8);

  const data = Buffer.concat([disc, assetId]);

  const ix = new anchor.web3.TransactionInstruction({
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_CONFIG, isSigner: false, isWritable: true },
      { pubkey: mintPubkey, isSigner: false, isWritable: false },
      { pubkey: assetVault, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = authority.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(authority);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction(sig, 'confirmed');
  console.log(`${name} registered:`, sig);
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
  const bal = await connection.getBalance(authority.publicKey);
  console.log("Balance:", (bal / 1e9).toFixed(4), "SOL");

  // 1. Register USDC
  await registerAsset(
    connection, authority, program,
    '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    '00f2217c84e99aeaeba16a418f8eaf74de9ab82f3e2ef07c9771dc10161618ca',
    'USDC'
  );

  // 2. Upload missing VKs
  const vkConfigs = [
    {
      name: "withdraw_v2",
      proofType: { withdrawV2: {} },
      seed: "vk_withdraw_v2",
      path: path.join(ROOT, "circuits/withdraw_v2/build/withdraw_v2_vk.json"),
    },
    {
      name: "membership",
      proofType: { membership: {} },
      seed: "vk_membership",
      path: path.join(ROOT, "circuits/membership/build/membership_vk.json"),
    },
    {
      name: "joinsplit",
      proofType: { joinSplit: {} },
      seed: "vk_joinsplit",
      path: path.join(ROOT, "circuits/joinsplit/build/joinsplit_vk.json"),
    },
  ];

  for (const config of vkConfigs) {
    await uploadVk(connection, authority, program, config);
  }

  console.log("\n✅ Production setup complete!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
