import fs from "fs";
import path from "path";
import crypto from "crypto";
import * as anchor from "@coral-xyz/anchor";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
} from "@solana/spl-token";
import * as snarkjs from "snarkjs";
import {
  initializeSDK,
  Prover,
  computeCommitment,
  computeNullifierHash,
  pubkeyToScalar,
} from "../../chains/solana/sdk/src";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const MERKLE_TREE = new PublicKey("2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD");
const PUBLIC_RELAYER = process.env.PUBLIC_RELAYER_URL || "https://relayer.thewhiteprotocol.com";
const WITHDRAW_RELAYER = process.env.WITHDRAW_RELAYER_URL || PUBLIC_RELAYER;
const WALLET_PATH = path.join(process.env.HOME || "", ".config/solana/id.json");
const AUTHORITY_WALLET_PATH = "/home/codespace/.config/solana/id.json";
const ROOT = process.cwd();
const IDL = JSON.parse(
  fs.readFileSync(path.join(ROOT, "chains/solana/target/idl/white_protocol.json"), "utf8"),
);

type Note = {
  label: string;
  amount: bigint;
  secret: bigint;
  nullifier: bigint;
  assetIdBytes: Uint8Array;
  assetIdBigInt: bigint;
  commitment: bigint;
  depositSignature: string;
};

type MerkleProofResponse = {
  success: boolean;
  leafIndex: number;
  merkleRoot: string;
  merkleRootHex: string;
  pathElements: string[];
  pathIndices: number[];
  error?: string;
};

type SettledNote = {
  leafIndex: number;
  merkleRoot: bigint;
  merkleRootHex: string;
  pathElements: bigint[];
  pathIndices: number[];
};

function randomField(): bigint {
  const bytes = crypto.randomBytes(31);
  let result = 0n;
  for (const byte of bytes) result = (result << 8n) | BigInt(byte);
  return result;
}

function bigintToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, "0");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
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

function computeAssetId(mint: PublicKey): Uint8Array {
  const prefix = Buffer.from("white:asset_id:v1");
  const input = Buffer.concat([prefix, mint.toBuffer()]);
  const hash = Buffer.from(keccak_256(input));
  const out = Buffer.alloc(32);
  out[0] = 0;
  hash.copy(out, 1, 0, 31);
  return out;
}

function logHeader(title: string): void {
  console.log(`\n=== ${title} ===`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json() as Promise<T>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getPoolAuthority(connection: Connection): Promise<PublicKey> {
  const info = await connection.getAccountInfo(POOL_CONFIG);
  if (!info) throw new Error("Pool config account not found");
  return new PublicKey(info.data.slice(8, 40));
}

async function getAssetVaultAndTokenAccount(
  connection: Connection,
  assetIdBytes: Uint8Array,
): Promise<{ assetVault: PublicKey; vaultTokenAccount: PublicKey }> {
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), POOL_CONFIG.toBuffer(), Buffer.from(assetIdBytes)],
    PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(assetVault);
  if (!info) throw new Error("Asset vault not found");
  return {
    assetVault,
    vaultTokenAccount: new PublicKey(info.data.slice(104, 136)),
  };
}

async function buildProgram(wallet: Keypair, connection: Connection) {
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const program = new anchor.Program(IDL as any, provider);
  return { provider, program };
}

async function settleOnePending(
  program: anchor.Program,
  connection: Connection,
): Promise<{
  signature: string;
  settledCommitment: bigint;
  leafIndex: number;
  merkleRoot: bigint;
  pathElements: bigint[];
  pathIndices: number[];
}> {
  const merkleTree = await (program.account as any).merkleTree.fetch(MERKLE_TREE);
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
  if (!pendingBuffer.deposits.length) {
    throw new Error("No pending deposits to settle");
  }

  const oldRoot = BigInt(`0x${Buffer.from(merkleTree.currentRoot).toString("hex")}`);
  const startIndex = Number(merkleTree.nextLeafIndex);
  const commitment = BigInt(`0x${Buffer.from(pendingBuffer.deposits[0].commitment).toString("hex")}`);
  const zeros: bigint[] = [];
  const filledSubtrees: bigint[] = [];
  for (let i = 0; i <= 20; i++) {
    zeros.push(BigInt(`0x${Buffer.from(merkleTree.zeros[i]).toString("hex")}`));
  }
  for (let i = 0; i < 20; i++) {
    filledSubtrees.push(BigInt(`0x${Buffer.from(merkleTree.filledSubtrees[i]).toString("hex")}`));
  }
  const poseidon = await import("../../chains/solana/sdk/src/crypto/poseidon");
  const pathElements: bigint[] = [];
  let newRoot = commitment;
  for (let i = 0; i < 20; i++) {
    const isRightChild = ((startIndex >> i) & 1) === 1;
    const sibling = isRightChild ? filledSubtrees[i] : zeros[i];
    pathElements.push(sibling);
    newRoot = isRightChild
      ? poseidon.hashTwo(sibling, newRoot)
      : poseidon.hashTwo(newRoot, sibling);
  }

  const hash = crypto.createHash("sha256");
  hash.update(Buffer.from(bigintToBytes32(commitment)));
  const digest = hash.digest();
  digest[0] &= 0x1f;
  const commitmentsHash = BigInt(`0x${digest.toString("hex")}`);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      oldRoot: oldRoot.toString(),
      newRoot: newRoot.toString(),
      startIndex,
      batchSize: 1,
      commitmentsHash: commitmentsHash.toString(),
      commitments: [commitment.toString()],
      pathElements: [pathElements.map((p) => p.toString())],
    },
    path.join(ROOT, "circuits/merkle_batch_update/build/merkle_batch_update_js/merkle_batch_update.wasm"),
    path.join(ROOT, "circuits/merkle_batch_update/build/merkle_batch_update.zkey"),
  ) as any;

  const vkJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "circuits/merkle_batch_update/build/verification_key.json"), "utf8"),
  );
  const localVerify = await snarkjs.groth16.verify(vkJson, publicSignals, proof);
  console.log("settlement witness debug:", {
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    startIndex,
    batchSize: 1,
    commitmentsHash: commitmentsHash.toString(),
    publicSignals,
    localVerify,
  });

  const proofBytes = serializeGroth16Proof(proof);
  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const signature = await (program.methods as any)
    .settleDepositsBatch({
      proof: Array.from(proofBytes),
      newRoot: Array.from(bigintToBytes32(newRoot)),
      batchSize: 1,
    })
    .accounts({
      authority: program.provider.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
      pendingBuffer: pendingBufferPda,
      verificationKey: vkPda,
    })
    .preInstructions([
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    ])
    .rpc();

  return {
    signature,
    settledCommitment: commitment,
    leafIndex: startIndex,
    merkleRoot: newRoot,
    pathElements,
    pathIndices: Array(20).fill(0),
  };
}

async function settleUntilCommitment(
  authorityProgram: anchor.Program,
  targetCommitment: bigint,
  maxSteps = 20,
): Promise<SettledNote> {
  logHeader("Authority Settlement");
  for (let i = 0; i < maxSteps; i++) {
    const pendingState = await fetchJson<{ success: boolean; pending: { count: number; commitments: string[] } }>(
      `${PUBLIC_RELAYER}/api/pool-state`,
    );
    console.log(`pending count: ${pendingState.pending.count}`);
    if (!pendingState.pending.commitments.includes(targetCommitment.toString())) {
      const noteState = await fetchJson<{ success: boolean; status?: string; leafIndex?: number }>(
        `${PUBLIC_RELAYER}/api/note/${targetCommitment.toString()}`,
      ).catch(() => ({ success: false }));
      if (noteState.status === "settled" && noteState.leafIndex !== undefined) {
        console.log(`target already settled at leaf ${noteState.leafIndex}`);
        const proof = await fetchJson<MerkleProofResponse>(
          `${PUBLIC_RELAYER}/api/merkle/proof/${noteState.leafIndex}`,
        );
        return {
          leafIndex: proof.leafIndex,
          merkleRoot: BigInt(proof.merkleRoot),
          merkleRootHex: proof.merkleRootHex,
          pathElements: proof.pathElements.map((v) => BigInt(v)),
          pathIndices: proof.pathIndices,
        };
      }
    }
    const step = await settleOnePending(authorityProgram, authorityProgram.provider.connection);
    console.log(`settled leaf ${step.leafIndex}: ${step.settledCommitment.toString()} tx=${step.signature}`);
    if (step.settledCommitment === targetCommitment) {
      return {
        leafIndex: step.leafIndex,
        merkleRoot: step.merkleRoot,
        merkleRootHex: bytesToHex(bigintToBytes32(step.merkleRoot)),
        pathElements: step.pathElements,
        pathIndices: step.pathIndices,
      };
    }
    await sleep(4_000);
  }
  throw new Error("Target commitment was not reached during settlement loop");
}

async function resetPool(authorityProgram: anchor.Program): Promise<void> {
  logHeader("Reset Pool State");
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );

  try {
    const resetSig = await (authorityProgram.methods as any)
      .resetMerkleTree()
      .accounts({
        authority: authorityProgram.provider.publicKey,
        poolConfig: POOL_CONFIG,
        merkleTree: MERKLE_TREE,
      })
      .rpc();
    console.log(`reset merkle tree tx: ${resetSig}`);
  } catch (error: any) {
    console.log(`reset merkle tree skipped: ${error.message}`);
  }

  try {
    const clearSig = await (authorityProgram.methods as any)
      .clearPendingBuffer()
      .accounts({
        authority: authorityProgram.provider.publicKey,
        poolConfig: POOL_CONFIG,
        pendingBuffer,
      })
      .rpc();
    console.log(`clear pending buffer tx: ${clearSig}`);
  } catch (error: any) {
    console.log(`clear pending buffer skipped: ${error.message}`);
  }

  await sleep(4_000);
}

function createProver(): Prover {
  return new Prover({
    0: {
      wasmPath: path.join(ROOT, "circuits/deposit/build/deposit_js/deposit.wasm"),
      zkeyPath: path.join(ROOT, "circuits/deposit/build/deposit.zkey"),
    },
    1: {
      wasmPath: path.join(ROOT, "circuits/withdraw/build/withdraw_js/withdraw.wasm"),
      zkeyPath: path.join(ROOT, "circuits/withdraw/build/withdraw.zkey"),
    },
    2: {
      wasmPath: path.join(ROOT, "circuits/joinsplit/build/joinsplit_js/joinsplit.wasm"),
      zkeyPath: path.join(ROOT, "circuits/joinsplit/build/joinsplit.zkey"),
    },
    3: {
      wasmPath: path.join(ROOT, "circuits/membership/build/membership_js/membership.wasm"),
      zkeyPath: path.join(ROOT, "circuits/membership/build/membership.zkey"),
    },
  } as any);
}

async function depositNote(
  wallet: Keypair,
  connection: Connection,
  label: string,
  amountSol: number,
): Promise<Note> {
  logHeader(`Deposit ${label}`);
  const amount = BigInt(Math.round(amountSol * LAMPORTS_PER_SOL));
  const secret = randomField();
  const nullifier = randomField();
  const assetIdBytes = computeAssetId(NATIVE_MINT);
  const assetIdBigInt = BigInt(`0x${bytesToHex(assetIdBytes)}`);
  const commitment = computeCommitment(secret, nullifier, amount, assetIdBigInt);
  const userTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [depositVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_deposit"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [commitmentIndex] = PublicKey.findProgramAddressSync(
    [Buffer.from("commitment"), POOL_CONFIG.toBuffer(), Buffer.from(bigintToBytes32(commitment))],
    PROGRAM_ID,
  );
  const authority = await getPoolAuthority(connection);
  const { assetVault, vaultTokenAccount } = await getAssetVaultAndTokenAccount(connection, assetIdBytes);
  const prover = createProver();
  const depositProof = await prover.generateDepositProof({
    secret,
    nullifier,
    amount,
    assetId: assetIdBigInt,
    commitment,
  });

  const preInstructions = [
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      userTokenAccount,
      wallet.publicKey,
      NATIVE_MINT,
    ),
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: userTokenAccount,
      lamports: Number(amount),
    }),
    createSyncNativeInstruction(userTokenAccount),
  ];

  const discriminator = Buffer.from([53, 229, 96, 103, 104, 75, 182, 133]);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);
  const proofLenBuf = Buffer.alloc(4);
  proofLenBuf.writeUInt32LE(depositProof.proofData.length);
  const instructionData = Buffer.concat([
    discriminator,
    amountBuf,
    Buffer.from(bigintToBytes32(commitment)),
    Buffer.from(assetIdBytes),
    proofLenBuf,
    Buffer.from(depositProof.proofData),
    Buffer.from([0]),
  ]);

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_CONFIG, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: false, isWritable: false },
      { pubkey: MERKLE_TREE, isSigner: false, isWritable: true },
      { pubkey: pendingBuffer, isSigner: false, isWritable: true },
      { pubkey: assetVault, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: NATIVE_MINT, isSigner: false, isWritable: false },
      { pubkey: depositVk, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: commitmentIndex, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: instructionData,
  });

  const tx = new Transaction();
  preInstructions.forEach((preIx) => tx.add(preIx));
  tx.add(ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [wallet], {
    commitment: "confirmed",
  });

  console.log(`deposit tx: ${signature}`);
  console.log(`commitment: ${commitment.toString()}`);

  await fetchJson<{ success: boolean }>(`${PUBLIC_RELAYER}/api/track-deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      commitment: commitment.toString(),
      txHash: signature,
    }),
  }).catch(() => undefined);

  return {
    label,
    amount,
    secret,
    nullifier,
    assetIdBytes,
    assetIdBigInt,
    commitment,
    depositSignature: signature,
  };
}

async function waitForSettlement(note: Note, timeoutMs = 240_000): Promise<{
  leafIndex: number;
  merkleRoot: bigint;
  merkleRootHex: string;
  pathElements: bigint[];
  pathIndices: number[];
}> {
  logHeader(`Wait For Settlement ${note.label}`);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await fetchJson<{
      success: boolean;
      status?: "pending" | "settled" | "unknown";
      leafIndex?: number;
      pendingIndex?: number;
    }>(`${PUBLIC_RELAYER}/api/note/${note.commitment.toString()}`);

    console.log(`status: ${status.status}${status.leafIndex !== undefined ? ` leaf=${status.leafIndex}` : ""}`);
    if (status.status === "settled" && status.leafIndex !== undefined) {
      const proof = await fetchJson<MerkleProofResponse>(
        `${PUBLIC_RELAYER}/api/merkle/proof/${status.leafIndex}`,
      );
      if (!proof.success) throw new Error(proof.error || "Merkle proof fetch failed");
      return {
        leafIndex: proof.leafIndex,
        merkleRoot: BigInt(proof.merkleRoot),
        merkleRootHex: proof.merkleRootHex,
        pathElements: proof.pathElements.map((v) => BigInt(v)),
        pathIndices: proof.pathIndices,
      };
    }
    await sleep(10_000);
  }
  throw new Error(`Timed out waiting for settlement of ${note.label}`);
}

async function directWithdraw(
  program: anchor.Program,
  connection: Connection,
  wallet: Keypair,
  note: Note,
  settled: Awaited<ReturnType<typeof waitForSettlement>>,
): Promise<string> {
  logHeader(`Direct Withdraw ${note.label}`);
  const prover = createProver();
  const nullifierHash = computeNullifierHash(note.nullifier, note.secret, BigInt(settled.leafIndex));
  const { assetVault, vaultTokenAccount } = await getAssetVaultAndTokenAccount(connection, note.assetIdBytes);
  const [withdrawVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [spentNullifier] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), POOL_CONFIG.toBuffer(), Buffer.from(bigintToBytes32(nullifierHash))],
    PROGRAM_ID,
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const recipientTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
  const relayerTokenAccount = recipientTokenAccount;
  const preInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      recipientTokenAccount,
      wallet.publicKey,
      NATIVE_MINT,
    ),
  ];

  const withdrawProof = await prover.generateWithdrawProof({
    merkleRoot: settled.merkleRoot,
    nullifierHash,
    assetId: note.assetIdBigInt,
    recipient: wallet.publicKey,
    amount: note.amount,
    relayer: wallet.publicKey,
    relayerFee: 0n,
    publicDataHash: 0n,
    secret: note.secret,
    nullifier: note.nullifier,
    leafIndex: settled.leafIndex,
    merkleProof: {
      pathElements: settled.pathElements,
      pathIndices: settled.pathIndices,
      leaf: note.commitment,
      root: settled.merkleRoot,
      leafIndex: settled.leafIndex,
    },
  });

  const signature = await (program.methods as any)
    .withdrawMasp(
      Buffer.from(withdrawProof.proofData),
      Array.from(bigintToBytes32(settled.merkleRoot)),
      Array.from(bigintToBytes32(nullifierHash)),
      wallet.publicKey,
      new anchor.BN(note.amount.toString()),
      Array.from(note.assetIdBytes),
      new anchor.BN(0),
    )
    .accounts({
      relayer: wallet.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
      vkAccount: withdrawVk,
      assetVault,
      vaultTokenAccount,
      recipientTokenAccount,
      relayerTokenAccount,
      spentNullifier,
      relayerRegistry,
      relayerNode: null,
      yieldRegistry: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions(preInstructions)
    .rpc();

  console.log(`withdraw tx: ${signature}`);
  return signature;
}

async function stealthWithdraw(
  program: anchor.Program,
  connection: Connection,
  wallet: Keypair,
  note: Note,
  settled: Awaited<ReturnType<typeof waitForSettlement>>,
): Promise<string> {
  logHeader(`Stealth Withdraw ${note.label}`);
  const { deriveStealthSeed, generateSolanaMetaAddressFromSeed, deriveStealthAddressEd25519 } =
    await import("../../packages/core/src/stealth");
  const seed = deriveStealthSeed(Uint8Array.from(Buffer.from("codex-live-stealth-seed".padEnd(32, "0"))));
  const { metaAddress } = generateSolanaMetaAddressFromSeed(seed);
  const stealth = deriveStealthAddressEd25519(metaAddress);
  const stealthPubkey = new PublicKey(stealth.address);
  const prover = createProver();
  const nullifierHash = computeNullifierHash(note.nullifier, note.secret, BigInt(settled.leafIndex));
  const { assetVault, vaultTokenAccount } = await getAssetVaultAndTokenAccount(connection, note.assetIdBytes);
  const [withdrawVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [spentNullifier] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), POOL_CONFIG.toBuffer(), Buffer.from(bigintToBytes32(nullifierHash))],
    PROGRAM_ID,
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const recipientTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, stealthPubkey);
  const relayerTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
  const preInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      recipientTokenAccount,
      stealthPubkey,
      NATIVE_MINT,
    ),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      relayerTokenAccount,
      wallet.publicKey,
      NATIVE_MINT,
    ),
  ];

  const withdrawProof = await prover.generateWithdrawProof({
    merkleRoot: settled.merkleRoot,
    nullifierHash,
    assetId: note.assetIdBigInt,
    recipient: stealthPubkey,
    amount: note.amount,
    relayer: wallet.publicKey,
    relayerFee: 0n,
    publicDataHash: 0n,
    secret: note.secret,
    nullifier: note.nullifier,
    leafIndex: settled.leafIndex,
    merkleProof: {
      pathElements: settled.pathElements,
      pathIndices: settled.pathIndices,
      leaf: note.commitment,
      root: settled.merkleRoot,
      leafIndex: settled.leafIndex,
    },
  });

  const signature = await (program.methods as any)
    .withdrawMaspStealth(
      Buffer.from(withdrawProof.proofData),
      Array.from(bigintToBytes32(settled.merkleRoot)),
      Array.from(bigintToBytes32(nullifierHash)),
      stealthPubkey,
      new anchor.BN(note.amount.toString()),
      Array.from(note.assetIdBytes),
      new anchor.BN(0),
      Array.from(stealth.ephemeralPubkey),
    )
    .accounts({
      relayer: wallet.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
      vkAccount: withdrawVk,
      assetVault,
      vaultTokenAccount,
      recipientTokenAccount,
      relayerTokenAccount,
      spentNullifier,
      relayerRegistry,
      relayerNode: null,
      yieldRegistry: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions(preInstructions)
    .rpc();

  console.log(`stealth withdraw tx: ${signature}`);
  console.log(`stealth recipient: ${stealthPubkey.toBase58()}`);
  return signature;
}

async function partialWithdrawV2(
  program: anchor.Program,
  connection: Connection,
  wallet: Keypair,
  note: Note,
  settled: Awaited<ReturnType<typeof waitForSettlement>>,
): Promise<{ signature: string; changeCommitment: bigint }> {
  logHeader(`Partial Withdraw V2 ${note.label}`);
  const withdrawAmount = note.amount / 2n;
  const changeAmount = note.amount - withdrawAmount;
  const changeSecret = randomField();
  const changeNullifier = randomField();
  const changeCommitment = computeCommitment(
    changeSecret,
    changeNullifier,
    changeAmount,
    note.assetIdBigInt,
  );
  const nullifierHash0 = computeNullifierHash(note.nullifier, note.secret, BigInt(settled.leafIndex));
  const nullifierHash1 = 0n;
  const witness = {
    schema_version: "2",
    merkle_root: settled.merkleRoot.toString(),
    asset_id: note.assetIdBigInt.toString(),
    nullifier_hash_0: nullifierHash0.toString(),
    nullifier_hash_1: "0",
    change_commitment: changeCommitment.toString(),
    recipient: pubkeyToScalar(wallet.publicKey).toString(),
    amount: withdrawAmount.toString(),
    relayer: pubkeyToScalar(wallet.publicKey).toString(),
    relayer_fee: "0",
    public_data_hash: "0",
    reserved_0: "0",
    input_secret: note.secret.toString(),
    input_nullifier: note.nullifier.toString(),
    input_amount: note.amount.toString(),
    leaf_index: settled.leafIndex.toString(),
    merkle_path: settled.pathElements.map((v) => v.toString()),
    merkle_path_indices: settled.pathIndices.map((v) => v.toString()),
    change_secret: changeSecret.toString(),
    change_nullifier: changeNullifier.toString(),
    change_amount: changeAmount.toString(),
  };
  const { proof } = await snarkjs.groth16.fullProve(
    witness,
    path.join(process.cwd(), "circuits/withdraw_v2/build/withdraw_v2_js/withdraw_v2.wasm"),
    path.join(process.cwd(), "circuits/withdraw_v2/build/withdraw_v2.zkey"),
  );
  const proofData = serializeGroth16Proof(proof);
  const { assetVault, vaultTokenAccount } = await getAssetVaultAndTokenAccount(connection, note.assetIdBytes);
  const [withdrawV2Vk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw_v2"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [spentNullifier0] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier"), POOL_CONFIG.toBuffer(), Buffer.from(bigintToBytes32(nullifierHash0))],
    PROGRAM_ID,
  );
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const recipientTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
  const relayerTokenAccount = recipientTokenAccount;
  const preInstructions = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_200_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
    createAssociatedTokenAccountIdempotentInstruction(
      wallet.publicKey,
      recipientTokenAccount,
      wallet.publicKey,
      NATIVE_MINT,
    ),
  ];

  const signature = await (program.methods as any)
    .withdrawV2(
      Buffer.from(proofData),
      Array.from(bigintToBytes32(settled.merkleRoot)),
      Array.from(note.assetIdBytes),
      Array.from(bigintToBytes32(nullifierHash0)),
      Array.from(bigintToBytes32(nullifierHash1)),
      Array.from(bigintToBytes32(changeCommitment)),
      wallet.publicKey,
      new anchor.BN(withdrawAmount.toString()),
      new anchor.BN(0),
    )
    .accounts({
      relayer: wallet.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
      vkAccount: withdrawV2Vk,
      assetVault,
      vaultTokenAccount,
      recipientTokenAccount,
      relayerTokenAccount,
      spentNullifier0,
      spentNullifier1: null,
      pendingBuffer,
      relayerRegistry,
      relayerNode: null,
      yieldRegistry: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .preInstructions(preInstructions)
    .rpc();

  console.log(`partial withdraw tx: ${signature}`);
  console.log(`change commitment: ${changeCommitment.toString()}`);
  return { signature, changeCommitment };
}

async function isCommitmentPendingOnChain(program: anchor.Program, commitment: bigint): Promise<boolean> {
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  const pendingState = await (program.account as any).pendingDepositsBuffer.fetch(pendingBuffer);
  const needle = bytesToHex(bigintToBytes32(commitment));
  return pendingState.deposits.some(
    (deposit: { commitment: number[] | Uint8Array | Buffer }) =>
      Buffer.from(deposit.commitment).toString("hex") === needle,
  );
}

async function relayerWithdraw(
  note: Note,
  settled: Awaited<ReturnType<typeof waitForSettlement>>,
  recipient: PublicKey,
): Promise<string> {
  logHeader(`Relayer Withdraw ${note.label}`);
  const prover = createProver();
  const quote = await fetchJson<{
    fee: string;
    relayer: { solana: string };
  }>(`${WITHDRAW_RELAYER}/quote?amount=${note.amount.toString()}`);
  const fee = BigInt(quote.fee);
  const relayer = new PublicKey(quote.relayer.solana);
  const nullifierHash = computeNullifierHash(note.nullifier, note.secret, BigInt(settled.leafIndex));
  const proof = await prover.generateWithdrawProof({
    merkleRoot: settled.merkleRoot,
    nullifierHash,
    assetId: note.assetIdBigInt,
    recipient,
    amount: note.amount,
    relayer,
    relayerFee: fee,
    publicDataHash: 0n,
    secret: note.secret,
    nullifier: note.nullifier,
    leafIndex: settled.leafIndex,
    merkleProof: {
      pathElements: settled.pathElements,
      pathIndices: settled.pathIndices,
      leaf: note.commitment,
      root: settled.merkleRoot,
      leafIndex: settled.leafIndex,
    },
  });

  const response = await fetchJson<{ success: boolean; signature?: string; error?: string }>(
    `${WITHDRAW_RELAYER}/withdraw`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chain: "solana",
        proofData: bytesToHex(proof.proofData),
        merkleRoot: settled.merkleRootHex,
        nullifierHash: bytesToHex(bigintToBytes32(nullifierHash)),
        recipient: recipient.toBase58(),
        amount: note.amount.toString(),
        assetId: bytesToHex(note.assetIdBytes),
        mint: NATIVE_MINT.toBase58(),
      }),
    },
  );
  if (!response.success || !response.signature) {
    throw new Error(response.error || "Relayer withdraw failed");
  }
  console.log(`relayer withdraw tx: ${response.signature}`);
  return response.signature;
}

async function main(): Promise<void> {
  await initializeSDK();
  const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(WALLET_PATH, "utf8"))));
  const authorityWallet = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(AUTHORITY_WALLET_PATH, "utf8"))),
  );
  const connection = new Connection(RPC, "confirmed");
  const { program } = await buildProgram(wallet, connection);
  const { program: authorityProgram } = await buildProgram(authorityWallet, connection);
  const balance = await connection.getBalance(wallet.publicKey);
  const authorityBalance = await connection.getBalance(authorityWallet.publicKey);

  console.log("wallet:", wallet.publicKey.toBase58());
  console.log("sol balance:", balance / LAMPORTS_PER_SOL);
  console.log("authority:", authorityWallet.publicKey.toBase58());
  console.log("authority sol balance:", authorityBalance / LAMPORTS_PER_SOL);

  const results: Record<string, string> = {};
  let partialChangeCommitment: bigint | null = null;
  let partialChangePending = false;

  await resetPool(authorityProgram);
  const deposit1 = await depositNote(wallet, connection, "full-withdraw", 0.01);
  const settled1 = await settleUntilCommitment(authorityProgram, deposit1.commitment, 1);
  results.depositFull = deposit1.depositSignature;
  results.withdrawFull = await directWithdraw(program, connection, wallet, deposit1, settled1);

  try {
    await resetPool(authorityProgram);
    const deposit2 = await depositNote(wallet, connection, "stealth-withdraw", 0.01);
    const settled2 = await settleUntilCommitment(authorityProgram, deposit2.commitment, 1);
    results.depositStealth = deposit2.depositSignature;
    results.withdrawStealth = await stealthWithdraw(program, connection, wallet, deposit2, settled2);
  } catch (error: any) {
    results.withdrawStealth = `failed: ${error.message}`;
  }

  try {
    await resetPool(authorityProgram);
    const deposit3 = await depositNote(wallet, connection, "partial-withdraw-v2", 0.012);
    const settled3 = await settleUntilCommitment(authorityProgram, deposit3.commitment, 1);
    const partial = await partialWithdrawV2(program, connection, wallet, deposit3, settled3);
    partialChangeCommitment = partial.changeCommitment;
    partialChangePending = await isCommitmentPendingOnChain(authorityProgram, partial.changeCommitment);
    results.depositPartial = deposit3.depositSignature;
    results.withdrawPartial = partial.signature;
  } catch (error: any) {
    results.withdrawPartial = `failed: ${error.message}`;
  }

  try {
    await resetPool(authorityProgram);
    const deposit4 = await depositNote(wallet, connection, "relayer-withdraw", 0.01);
    const settled4 = await settleUntilCommitment(authorityProgram, deposit4.commitment, 1);
    results.depositRelayer = deposit4.depositSignature;
    results.withdrawRelayer = await relayerWithdraw(deposit4, settled4, wallet.publicKey);
  } catch (error: any) {
    results.withdrawRelayer = `failed: ${error.message}`;
  }

  const changeStatus =
    partialChangeCommitment === null
      ? "not-created"
      : partialChangePending
        ? "pending-onchain"
        : "missing-onchain";

  logHeader("Summary");
  console.log(`deposit full: ${results.depositFull}`);
  console.log(`withdraw full: ${results.withdrawFull}`);
  console.log(`deposit stealth: ${results.depositStealth || "skipped"}`);
  console.log(`withdraw stealth: ${results.withdrawStealth || "skipped"}`);
  console.log(`deposit partial: ${results.depositPartial || "skipped"}`);
  console.log(`withdraw v2 partial: ${results.withdrawPartial || "skipped"}`);
  console.log(`change commitment status: ${changeStatus}`);
  console.log(`deposit relayer: ${results.depositRelayer || "skipped"}`);
  console.log(`relayer withdraw: ${results.withdrawRelayer || "skipped"}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
