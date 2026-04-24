import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { ComputeBudgetProgram, Connection, Keypair, PublicKey } from "@solana/web3.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as snarkjs from "snarkjs";

const ROOT = process.cwd();
const RPC_ENDPOINT = process.env.RPC_ENDPOINT || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || "C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey(process.env.POOL_CONFIG || "EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const AUTHORITY_KEYPAIR_PATH =
  process.env.AUTHORITY_KEYPAIR_PATH || "/home/codespace/.config/solana/id.json";
const IDL = JSON.parse(fs.readFileSync(path.join(ROOT, "chains/solana/target/idl/white_protocol.json"), "utf8"));
const WASM_PATH =
  process.env.MERKLE_BATCH_WASM_PATH ||
  path.join(ROOT, "circuits/merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm");
const ZKEY_PATH =
  process.env.MERKLE_BATCH_ZKEY_PATH ||
  path.join(ROOT, "circuits/merkle_batch_update/build/merkle_batch_update.zkey");
const EXISTING_LEAVES = (process.env.EXISTING_LEAVES || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean)
  .map((v) => BigInt(v.startsWith("0x") ? v : v));

const MERKLE_DEPTH = 20;

function bigintToBytes32(value: bigint): Uint8Array {
  return Uint8Array.from(Buffer.from(value.toString(16).padStart(64, "0"), "hex"));
}

function serializeGroth16Proof(proof: any): Uint8Array {
  const proofBytes = new Uint8Array(256);
  const toHex32 = (value: string | bigint) => BigInt(value).toString(16).padStart(64, "0");

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

function bytesToBigInt(bytes: Uint8Array | Buffer): bigint {
  return BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
}

async function buildProgram(authority: Keypair): Promise<Program> {
  const connection = new Connection(RPC_ENDPOINT, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(authority), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  return new anchor.Program(IDL as anchor.Idl, provider);
}

let poseidon: typeof import("../../chains/solana/sdk/src/crypto/poseidon") | null = null;

async function hashTwo(left: bigint, right: bigint): Promise<bigint> {
  if (!poseidon) {
    poseidon = await import("../../chains/solana/sdk/src/crypto/poseidon");
    await poseidon.initPoseidon();
  }
  return poseidon.hashTwo(left, right);
}

async function computeInsertPath(leaves: bigint[], index: number, zeros: bigint[]): Promise<bigint[]> {
  let level = [...leaves];
  let idx = index;
  const pathElements: bigint[] = [];

  for (let depth = 0; depth < MERKLE_DEPTH; depth++) {
    const siblingIndex = idx ^ 1;
    pathElements.push(siblingIndex < level.length ? level[siblingIndex] : zeros[depth]);

    const nextLevel: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : zeros[depth];
      nextLevel.push(await hashTwo(left, right));
    }
    level = nextLevel;
    idx >>= 1;
  }

  return pathElements;
}

async function settleOne(program: Program): Promise<{ signature: string; commitment: bigint; leafIndex: number }> {
  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );

  const merkleTree = await (program.account as any).merkleTree.fetch(merkleTreePda);
  const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
  if (!pendingBuffer.deposits.length) {
    throw new Error("No pending deposits");
  }

  const oldRoot = bytesToBigInt(merkleTree.currentRoot);
  const startIndex = Number(merkleTree.nextLeafIndex);
  const commitment = bytesToBigInt(pendingBuffer.deposits[0].commitment);

  const zeros: bigint[] = [];
  const filledSubtrees: bigint[] = [];
  for (let i = 0; i <= MERKLE_DEPTH; i++) zeros.push(bytesToBigInt(merkleTree.zeros[i]));
  for (let i = 0; i < MERKLE_DEPTH; i++) filledSubtrees.push(bytesToBigInt(merkleTree.filledSubtrees[i]));

  const pathElements =
    EXISTING_LEAVES.length === startIndex
      ? await computeInsertPath(EXISTING_LEAVES, startIndex, zeros)
      : await (async () => {
          const fallbackPath: bigint[] = [];
          for (let i = 0; i < MERKLE_DEPTH; i++) {
            const isRightChild = ((startIndex >> i) & 1) === 1;
            fallbackPath.push(isRightChild ? filledSubtrees[i] : zeros[i]);
          }
          return fallbackPath;
        })();

  let newRoot = commitment;
  for (let i = 0; i < MERKLE_DEPTH; i++) {
    const isRightChild = ((startIndex >> i) & 1) === 1;
    const sibling = pathElements[i];
    newRoot = isRightChild ? await hashTwo(sibling, newRoot) : await hashTwo(newRoot, sibling);
  }

  // Compute commitments hash exactly as on-chain settle_deposits_batch does:
  // 1. Pad to MAX_BATCH_SIZE * 32 bytes (here maxBatch=1)
  // 2. Reduce mod BN254_P if needed (no-op for honest Poseidon outputs)
  // 3. SHA256 over preimage
  // 4. Clear top 3 bits of first byte
  const BN254_P = Buffer.from([
    0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
    0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
    0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
    0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
  ]);

  function isGteBigEndian(a: Buffer, b: Buffer): boolean {
    for (let i = 0; i < 32; i++) {
      if (a[i] > b[i]) return true;
      if (a[i] < b[i]) return false;
    }
    return true;
  }

  function subBigEndian(a: Buffer, b: Buffer): Buffer {
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

  function reduceModP(value: bigint): Buffer {
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

  const { proof } = (await snarkjs.groth16.fullProve(
    {
      oldRoot: oldRoot.toString(),
      newRoot: newRoot.toString(),
      startIndex,
      batchSize: 1,
      commitmentsHash: commitmentsHash.toString(),
      commitments: [commitment.toString()],
      pathElements: [pathElements.map((p) => p.toString())],
    },
    WASM_PATH,
    ZKEY_PATH,
  )) as any;

  const proofBytes = serializeGroth16Proof(proof);
  const signature = await (program.methods as any)
    .settleDepositsBatch({
      proof: Array.from(proofBytes),
      newRoot: Array.from(bigintToBytes32(newRoot)),
      batchSize: 1,
    })
    .accounts({
      authority: program.provider.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: merkleTreePda,
      pendingBuffer: pendingBufferPda,
      verificationKey: vkPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ])
    .rpc();

  return { signature, commitment, leafIndex: startIndex };
}

async function batchProcessOne(program: Program): Promise<string> {
  const [merkleTreePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );

  return (program.methods as any)
    .batchProcessDeposits(1)
    .accounts({
      batcher: program.provider.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: merkleTreePda,
      pendingBuffer: pendingBufferPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ])
    .rpc();
}

async function main(): Promise<void> {
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(AUTHORITY_KEYPAIR_PATH, "utf8"))),
  );
  const program = await buildProgram(authority);
  const poolConfig = await (program.account as any).poolConfig.fetch(POOL_CONFIG);
  const poolAuthority = new PublicKey(poolConfig.authority);
  if (!poolAuthority.equals(authority.publicKey)) {
    throw new Error(`Authority mismatch: pool=${poolAuthority.toBase58()} keypair=${authority.publicKey.toBase58()}`);
  }

  const max = Number(process.env.MAX_SETTLEMENTS || "20");
  console.log(`authority=${authority.publicKey.toBase58()}`);
  for (let i = 0; i < max; i++) {
    try {
      if (process.env.USE_BATCH_PROCESS === "1") {
        const signature = await batchProcessOne(program);
        console.log(`batch_process_deposits tx=${signature}`);
        continue;
      }
      const result = await settleOne(program);
      console.log(`settled leaf=${result.leafIndex} commitment=${result.commitment.toString()} tx=${result.signature}`);
      if (EXISTING_LEAVES.length === result.leafIndex) {
        EXISTING_LEAVES.push(result.commitment);
      }
    } catch (error: any) {
      if (String(error?.message || "").includes("No pending deposits")) {
        console.log("no pending deposits remain");
        return;
      }
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
