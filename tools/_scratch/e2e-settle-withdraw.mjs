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
} from "@solana/web3.js";
import * as snarkjs from "snarkjs";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk");
const POOL_CONFIG = new PublicKey("5tiLj9YYhsc28h1JVVBBeUmUKmwTEUEnzn7q86NNso6q");
const MERKLE_TREE = new PublicKey("3Zo9P2p8582y9mTbP49TUC7hk8aDDo5Sz3fYQBDFkFhc");
const PENDING_DEPOSITS = new PublicKey("4A63xarGARyQyq5C37kHQcZEixeoyKhkqEoocGGEkjxh");
const WALLET_PATH = "/home/codespace/.config/solana/id.json";
const ROOT = process.cwd();
const IDL_PATH = path.join(ROOT, "chains/solana/target/idl/white_protocol.json");

const MERKLE_DEPTH = 20;
const WASM_PATH = path.join(ROOT, "circuits/merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm");
const ZKEY_PATH = path.join(ROOT, "circuits/merkle_batch_update/build/merkle_batch_update.zkey");

function bigintToBytes32(value) {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function bytesToBigInt(bytes) {
  return BigInt("0x" + Buffer.from(bytes).toString("hex"));
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

let poseidon = null;
async function initPoseidon() {
  if (!poseidon) {
    const mod = await import("../../chains/solana/sdk/src/crypto/poseidon.ts");
    await mod.initPoseidon();
    poseidon = mod;
  }
}

async function hashTwo(left, right) {
  await initPoseidon();
  return poseidon.hashTwo(left, right);
}

// Parse MerkleTree account manually
async function parseMerkleTree(connection) {
  const acc = await connection.getAccountInfo(MERKLE_TREE);
  const data = acc.data;
  let off = 8;
  const pool = new PublicKey(data.slice(off, off + 32)); off += 32;
  const depth = data[off]; off += 1;
  const nextLeafIndex = data.readUInt32LE(off); off += 4;
  const currentRoot = data.slice(off, off + 32); off += 32;
  const rootHistoryLen = data.readUInt32LE(off); off += 4;
  const rootHistory = [];
  for (let i = 0; i < rootHistoryLen; i++) {
    rootHistory.push(data.slice(off, off + 32)); off += 32;
  }
  const rootHistoryIndex = data.readUInt16LE(off); off += 2;
  const rootHistorySize = data.readUInt16LE(off); off += 2;
  const filledSubtreesLen = data.readUInt32LE(off); off += 4;
  const filledSubtrees = [];
  for (let i = 0; i < filledSubtreesLen; i++) {
    filledSubtrees.push(bytesToBigInt(data.slice(off, off + 32))); off += 32;
  }
  const zerosLen = data.readUInt32LE(off); off += 4;
  const zeros = [];
  for (let i = 0; i < zerosLen; i++) {
    zeros.push(bytesToBigInt(data.slice(off, off + 32))); off += 32;
  }
  const totalLeaves = data.readBigUInt64LE(off); off += 8;
  const lastInsertionAt = data.readBigUInt64LE(off); off += 8;
  const version = data[off];
  return { depth, nextLeafIndex, currentRoot: bytesToBigInt(currentRoot), filledSubtrees, zeros, totalLeaves, version };
}

// Parse PendingDepositsBuffer manually
// Layout: 8(disc) + 32(pool) + 4(vec_len) + 4000(100*40 deposits) + 4(total_pending) + 8(last_batch_at) + 8(total_batches) + 8(total_deposits) + 1(bump) + 1(version)
async function parsePendingBuffer(connection) {
  const acc = await connection.getAccountInfo(PENDING_DEPOSITS);
  const data = acc.data;
  const DEPOSIT_ENTRY_LEN = 40; // 32 commitment + 8 timestamp
  const MAX_PENDING = 100;
  
  let off = 8;
  const pool = new PublicKey(data.slice(off, off + 32)); off += 32;
  const vecLen = data.readUInt32LE(off); off += 4;
  
  const deposits = [];
  for (let i = 0; i < vecLen; i++) {
    const commitment = data.slice(off, off + 32); off += 32;
    const timestamp = data.readBigInt64LE(off); off += 8;
    deposits.push({ commitment: bytesToBigInt(commitment), timestamp });
  }
  
  // Skip remaining empty slots
  off += (MAX_PENDING - vecLen) * DEPOSIT_ENTRY_LEN;
  
  const totalPending = data.readUInt32LE(off); off += 4;
  const lastBatchAt = data.readBigInt64LE(off); off += 8;
  const totalBatches = data.readBigUInt64LE(off); off += 8;
  const totalDepositsBatched = data.readBigUInt64LE(off); off += 8;
  const bump = data[off]; off += 1;
  const version = data[off];
  
  return { pool, vecLen, deposits, totalPending, lastBatchAt, totalBatches, totalDepositsBatched, bump, version };
}

async function settleDeposits(connection, authority, program) {
  console.log("\n=== SETTLE PENDING DEPOSITS ===");
  const merkleTree = await parseMerkleTree(connection);
  const pendingBuffer = await parsePendingBuffer(connection);

  if (pendingBuffer.deposits.length === 0) {
    console.log("No pending deposits to settle");
    return null;
  }

  console.log("Pending deposits:", pendingBuffer.deposits.length);
  console.log("Next leaf index:", merkleTree.nextLeafIndex);

  const commitment = pendingBuffer.deposits[0].commitment;
  const startIndex = merkleTree.nextLeafIndex;

  // Compute insertion path
  const pathElements = [];
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    const isRightChild = ((startIndex >> i) & 1) === 1;
    pathElements.push(isRightChild ? merkleTree.filledSubtrees[i] : merkleTree.zeros[i]);
  }

  // Compute new root
  let newRoot = commitment;
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    const isRightChild = ((startIndex >> i) & 1) === 1;
    const sibling = pathElements[i];
    newRoot = isRightChild ? await hashTwo(sibling, newRoot) : await hashTwo(newRoot, sibling);
  }

  console.log("Old root:", merkleTree.currentRoot.toString());
  console.log("New root:", newRoot.toString());

  // Compute commitmentsHash
  const BN254_P = Buffer.from([
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
  ]);

  function isGteBigEndian(a, b) {
    for (let i = 0; i < 32; i++) {
      if (a[i] > b[i]) return true;
      if (a[i] < b[i]) return false;
    }
    return true;
  }

  function subBigEndian(a, b) {
    const result = Buffer.alloc(32);
    let borrow = 0;
    for (let i = 31; i >= 0; i--) {
      const diff = a[i] - b[i] - borrow;
      if (diff < 0) {
        result[i] = diff + 256;
        borrow = 1;
      } else {
        result[i] = diff;
        borrow = 0;
      }
    }
    return result;
  }

  function reduceModP(value) {
    let bytes = Buffer.from(value.toString(16).padStart(64, '0'), 'hex');
    while (isGteBigEndian(bytes, BN254_P)) {
      bytes = subBigEndian(bytes, BN254_P);
    }
    return bytes;
  }

  const preimage = Buffer.alloc(32, 0);
  reduceModP(commitment).copy(preimage, 0);
  const digest = crypto.createHash("sha256").update(preimage).digest();
  digest[0] &= 0x1f;
  const commitmentsHash = bytesToBigInt(digest);

  console.log("Generating batch proof...");
  const { proof } = await snarkjs.groth16.fullProve(
    {
      oldRoot: merkleTree.currentRoot.toString(),
      newRoot: newRoot.toString(),
      startIndex,
      batchSize: 1,
      commitmentsHash: commitmentsHash.toString(),
      commitments: [commitment.toString()],
      pathElements: [pathElements.map((p) => p.toString())],
    },
    WASM_PATH,
    ZKEY_PATH,
  );

  const proofBytes = serializeGroth16Proof(proof);
  console.log("Proof generated, size:", proofBytes.length);

  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );

  console.log("Submitting settlement...");
  const tx = await program.methods
    .settleDepositsBatch({
      proof: Array.from(proofBytes),
      newRoot: Array.from(bigintToBytes32(newRoot)),
      batchSize: 1,
    })
    .accountsStrict({
      authority: authority.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
      pendingBuffer: PENDING_DEPOSITS,
      verificationKey: vkPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ])
    .rpc({ commitment: "confirmed" });

  console.log("✅ Settlement successful:", tx);
  return { commitment, leafIndex: startIndex };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  E2E TEST: Settle Pending Deposits");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const connection = new Connection(RPC, "confirmed");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new anchor.Program(JSON.parse(fs.readFileSync(IDL_PATH, "utf8")), provider);

  console.log("Authority:", authority.publicKey.toBase58());

  const settled = await settleDeposits(connection, authority, program);
  if (!settled) {
    console.log("Nothing to settle");
    return;
  }

  console.log("\n📌 Settlement complete. Deposit is now in the Merkle tree at leaf index", settled.leafIndex);
  console.log("   Commitment:", settled.commitment.toString());
  console.log("\n✅ E2E settlement test complete!");
}

main().catch((err) => {
  console.error("\n❌ E2E TEST FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
