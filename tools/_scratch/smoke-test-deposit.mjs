import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import * as snarkjs from "snarkjs";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk");
const POOL_CONFIG = new PublicKey("5tiLj9YYhsc28h1JVVBBeUmUKmwTEUEnzn7q86NNso6q");
const MERKLE_TREE = new PublicKey("3Zo9P2p8582y9mTbP49TUC7hk8aDDo5Sz3fYQBDFkFhc");
const PENDING_DEPOSITS = new PublicKey("4A63xarGARyQyq5C37kHQcZEixeoyKhkqEoocGGEkjxh");
const WALLET_PATH = "/home/codespace/.config/solana/id.json";
const ROOT = process.cwd();
const IDL = JSON.parse(fs.readFileSync(path.join(ROOT, "chains/solana/target/idl/white_protocol.json"), "utf8"));

const TEST_AMOUNT = 0.05 * LAMPORTS_PER_SOL;

function randomField() {
  const bytes = crypto.randomBytes(31);
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

function bigintToBytes32(value) {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function bytesToHex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function computeAssetId(mint) {
  const prefix = Buffer.from("white:asset_id:v1");
  const input = Buffer.concat([prefix, mint.toBuffer()]);
  const hash = Buffer.from(keccak_256(input));
  const out = Buffer.alloc(32);
  out[0] = 0;
  hash.copy(out, 1, 0, 31);
  return out;
}

function serializeGroth16Proof(proof) {
  const proofBytes = new Uint8Array(256);
  const toHex32 = (value) => BigInt(value).toString(16).padStart(64, "0");
  proofBytes.set(Buffer.from(toHex32(proof.pi_a[0]), "hex"), 0);
  proofBytes.set(Buffer.from(toHex32(proof.pi_a[1]), "hex"), 32);
  proofBytes.set(Buffer.from(toHex32(proof.pi_b[0][1]), "hex"), 64);
  proofBytes.set(Buffer.from(toHex32(proof.pi_b[0][0]), "hex"), 96);
  proofBytes.set(Buffer.from(toHex32(proof.pi_b[1][1]), "hex"), 128);
  proofBytes.set(Buffer.from(toHex32(proof.pi_b[1][0]), "hex"), 160);
  proofBytes.set(Buffer.from(toHex32(proof.pi_c[0]), "hex"), 192);
  proofBytes.set(Buffer.from(toHex32(proof.pi_c[1]), "hex"), 224);
  return proofBytes;
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SMOKE TEST: Deposit on new deployment");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const connection = new Connection(RPC, "confirmed");
  const depositor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(depositor), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(IDL, provider);

  console.log("👤 Depositor:", depositor.publicKey.toBase58());
  const balance = await connection.getBalance(depositor.publicKey);
  console.log("💰 Balance:", (balance / LAMPORTS_PER_SOL).toFixed(4), "SOL");

  if (balance < TEST_AMOUNT + 0.02 * LAMPORTS_PER_SOL) {
    throw new Error(`Insufficient balance. Need ${TEST_AMOUNT / LAMPORTS_PER_SOL} SOL + fees`);
  }

  // ─── 1. VERIFY POOL STATE ───
  console.log("\n📋 Verifying pool state...");
  const poolAcc = await connection.getAccountInfo(POOL_CONFIG);
  if (!poolAcc) throw new Error("PoolConfig not found");
  console.log("  ✅ PoolConfig exists, lamports:", poolAcc.lamports, "dataLen:", poolAcc.data.length);

  const mtAcc = await connection.getAccountInfo(MERKLE_TREE);
  if (!mtAcc) throw new Error("MerkleTree not found");
  console.log("  ✅ MerkleTree exists, lamports:", mtAcc.lamports, "dataLen:", mtAcc.data.length);

  const pdAcc = await connection.getAccountInfo(PENDING_DEPOSITS);
  if (!pdAcc) throw new Error("PendingDeposits not found");
  console.log("  ✅ PendingDeposits exists, lamports:", pdAcc.lamports, "dataLen:", pdAcc.data.length);

  const authority = new PublicKey(poolAcc.data.slice(8, 40));
  console.log("  Pool authority:", authority.toBase58());
  console.log("  Paused:", poolAcc.data[40] !== 0);
  console.log("  Merkle tree depth:", mtAcc.data[40]);
  console.log("  Next leaf index:", mtAcc.data.readUInt32LE(41));

  // ─── 2. GENERATE COMMITMENT ───
  const secret = randomField();
  const nullifier = randomField();
  const amount = BigInt(TEST_AMOUNT);
  const assetIdBytes = computeAssetId(NATIVE_MINT);
  const assetIdBigInt = BigInt("0x" + bytesToHex(assetIdBytes));

  const { initPoseidon, hashFour } = await import("../../chains/solana/sdk/src/crypto/poseidon.ts");
  await initPoseidon();
  const commitment = hashFour(secret, nullifier, amount, assetIdBigInt);
  console.log("\n📝 Commitment:", commitment.toString());

  // ─── 3. GENERATE PROOF ───
  console.log("\n🔐 Generating deposit proof...");
  const wasmPath = path.join(ROOT, "circuits/deposit/build/deposit_js/deposit.wasm");
  const zkeyPath = path.join(ROOT, "circuits/deposit/build/deposit.zkey");

  if (!fs.existsSync(wasmPath)) throw new Error("Missing deposit.wasm");
  if (!fs.existsSync(zkeyPath)) throw new Error("Missing deposit.zkey");

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      secret: secret.toString(),
      nullifier: nullifier.toString(),
      amount: amount.toString(),
      asset_id: assetIdBigInt.toString(),
      commitment: commitment.toString(),
    },
    wasmPath,
    zkeyPath
  );
  console.log("✅ Proof generated");

  const proofData = Buffer.from(serializeGroth16Proof(proof));
  console.log("📦 Proof size:", proofData.length, "bytes");

  // ─── 4. DERIVE ACCOUNTS ───
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), POOL_CONFIG.toBuffer(), assetIdBytes],
    PROGRAM_ID
  );
  const [depositVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_deposit"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  const [commitmentIndex] = PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), POOL_CONFIG.toBuffer(), bigintToBytes32(commitment)],
    PROGRAM_ID
  );

  const avAcc = await connection.getAccountInfo(assetVault);
  if (!avAcc) throw new Error("AssetVault not found");
  // Correct offset: 8 (disc) + 32 (pool) + 32 (asset_id) + 32 (mint) + 32 (token_account) = 136
  // Wait: 8 + 32 + 32 + 32 = 104, token_account starts at 104
  const vaultTokenAccount = new PublicKey(avAcc.data.slice(104, 136));
  const userTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, depositor.publicKey);

  console.log("🏦 AssetVault:", assetVault.toBase58());
  console.log("💳 VaultTokenAccount:", vaultTokenAccount.toBase58());
  console.log("👛 UserTokenAccount:", userTokenAccount.toBase58());

  // ─── 5. PREPARE TRANSACTION ───
  const preInstructions = [];
  const userAtaInfo = await connection.getAccountInfo(userTokenAccount);
  const ataMissing = !userAtaInfo || !userAtaInfo.owner.equals(TOKEN_PROGRAM_ID);

  if (ataMissing) {
    console.log("➕ Creating user wSOL ATA...");
    preInstructions.push(
      createAssociatedTokenAccountInstruction(depositor.publicKey, userTokenAccount, depositor.publicKey, NATIVE_MINT)
    );
  }

  preInstructions.push(
    SystemProgram.transfer({
      fromPubkey: depositor.publicKey,
      toPubkey: userTokenAccount,
      lamports: TEST_AMOUNT,
    })
  );
  preInstructions.push(createSyncNativeInstruction(userTokenAccount));

  // ─── 6. SEND DEPOSIT ───
  console.log("\n📤 Submitting deposit transaction...");
  const tx = await program.methods
    .depositMasp(
      new BN(TEST_AMOUNT),
      Array.from(bigintToBytes32(commitment)),
      Array.from(assetIdBytes),
      proofData,
      null
    )
    .accountsStrict({
      depositor: depositor.publicKey,
      poolConfig: POOL_CONFIG,
      authority,
      merkleTree: MERKLE_TREE,
      pendingBuffer: PENDING_DEPOSITS,
      assetVault,
      vaultTokenAccount,
      userTokenAccount,
      mint: NATIVE_MINT,
      depositVk,
      tokenProgram: TOKEN_PROGRAM_ID,
      commitmentIndex,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions(preInstructions)
    .rpc({ commitment: "confirmed" });

  console.log("\n🎉 DEPOSIT SUCCESSFUL!");
  console.log("   Tx:", tx);
  console.log("   Explorer: https://explorer.solana.com/tx/" + tx + "?cluster=devnet");

  // ─── 7. VERIFY STATE UPDATE ───
  const pdAfter = await connection.getAccountInfo(PENDING_DEPOSITS);
  const sizeAfter = pdAfter.data.readUInt32LE(44);
  console.log("\n📊 Pending deposits after:", sizeAfter);
}

main().catch((err) => {
  console.error("\n❌ SMOKE TEST FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
