/**
 * The White Protocol v2 Withdraw Integration Test
 * 
 * Tests the complete flow:
 * 1. Make a deposit
 * 2. Settle via batch (sequencer)
 * 3. Generate withdraw proof
 * 4. Submit withdrawal
 * 
 * Run: ANCHOR_WALLET=... ANCHOR_PROVIDER_URL=... npx ts-node tests/withdraw-integration.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import { 
  PublicKey, 
  Keypair, 
  SystemProgram, 
  Transaction, 
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL
} from "@solana/web3.js";
import { 
  TOKEN_PROGRAM_ID, 
  NATIVE_MINT, 
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

// @ts-ignore
const snarkjs = require("snarkjs");

// ============================================================================
// CONFIGURATION - FRESH POOL
// ============================================================================
const CONFIG = {
  PROGRAM_ID: new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"),
  POOL_CONFIG: new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw"),
  MERKLE_TREE: new PublicKey("E1vS4WWQZ6j3jrbtr9gE8yotTAVqq1HNqEWN7ybjC8s3"),
  PENDING_BUFFER: new PublicKey("AWyMRtNEfA4AvVUFmyVmdzupUQtHUbnnJeqGCYZ3pZ1m"),
  
  MERKLE_DEPTH: 20,
  MAX_BATCH_SIZE: 16,
  
  // Circuit paths
  DEPOSIT_WASM: path.join(__dirname, "../circuits/build/deposit_js/deposit.wasm"),
  DEPOSIT_ZKEY: path.join(__dirname, "../circuits/build/deposit.zkey"),
  WITHDRAW_WASM: path.join(__dirname, "../circuits/build/withdraw_js/withdraw.wasm"),
  WITHDRAW_ZKEY: path.join(__dirname, "../circuits/build/withdraw.zkey"),
  MERKLE_BATCH_WASM: path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_js/merkle_batch_update.wasm"),
  MERKLE_BATCH_ZKEY: path.join(__dirname, "../circuits/build/merkle_batch_update/merkle_batch_update_final.zkey"),
};

// ============================================================================
// POSEIDON
// ============================================================================
let poseidon: any;
let F: any;

async function initPoseidon(): Promise<void> {
  const circomlibjs = await import("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((x: bigint) => F.e(x)));
  return F.toObject(hash);
}

// ============================================================================
// UTILITIES
// ============================================================================
function randomFieldElement(): bigint {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let result = 0n;
  for (const b of bytes) {
    result = (result << 8n) | BigInt(b);
  }
  return result;
}

function bigintToBytes32BE(bn: bigint): number[] {
  const hex = bn.toString(16).padStart(64, "0");
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

function bytes32ToBigint(bytes: number[] | Uint8Array): bigint {
  let hex = "0x";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return BigInt(hex);
}

function computeAssetId(mint: PublicKey): Buffer {
  const keccak = require("js-sha3").keccak256;
  const prefix = Buffer.from("white:asset_id:v1");
  const mintBytes = mint.toBuffer();
  const combined = Buffer.concat([prefix, mintBytes]);
  const hash = Buffer.from(keccak(combined), "hex");
  
  const assetId = Buffer.alloc(32);
  assetId[0] = 0x00;
  hash.copy(assetId, 1, 0, 31);
  return assetId;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// LOCAL MERKLE TREE (for tracking state)
// ============================================================================
class LocalMerkleTree {
  depth: number;
  leaves: bigint[];
  private zeros: bigint[];

  constructor(depth: number) {
    this.depth = depth;
    this.leaves = [];
    this.zeros = this.computeZeros();
  }

  private computeZeros(): bigint[] {
    const zeros: bigint[] = [0n];
    for (let i = 1; i <= this.depth; i++) {
      zeros[i] = poseidonHash([zeros[i - 1], zeros[i - 1]]);
    }
    return zeros;
  }

  getRoot(): bigint {
    if (this.leaves.length === 0) {
      return this.zeros[this.depth];
    }

    let level = [...this.leaves];
    const size = 1 << this.depth;
    while (level.length < size) {
      level.push(0n);
    }

    for (let d = 0; d < this.depth; d++) {
      const nextLevel: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(poseidonHash([level[i], level[i + 1]]));
      }
      level = nextLevel;
    }

    return level[0];
  }

  getMerklePath(index: number): { pathElements: bigint[]; pathIndices: number[] } {
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;

    let level = [...this.leaves];
    const size = 1 << this.depth;
    while (level.length < size) {
      level.push(0n);
    }

    for (let d = 0; d < this.depth; d++) {
      const siblingIndex = currentIndex ^ 1;
      pathElements.push(level[siblingIndex] ?? this.zeros[d]);
      pathIndices.push(currentIndex & 1);

      const nextLevel: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        nextLevel.push(poseidonHash([level[i], level[i + 1]]));
      }
      level = nextLevel;
      currentIndex = currentIndex >> 1;
    }

    return { pathElements, pathIndices };
  }

  insert(commitment: bigint): number {
    const index = this.leaves.length;
    this.leaves.push(commitment);
    return index;
  }
}

// ============================================================================
// DEPOSIT NOTE (stores private data for withdrawal)
// ============================================================================
interface DepositNote {
  secret: bigint;
  nullifier: bigint;
  amount: bigint;
  assetId: bigint;
  commitment: bigint;
  leafIndex: number;
}

function createDepositNote(amount: bigint, assetId: bigint): Omit<DepositNote, 'leafIndex'> {
  const secret = randomFieldElement();
  const nullifier = randomFieldElement();
  const commitment = poseidonHash([secret, nullifier, amount, assetId]);
  
  return {
    secret,
    nullifier,
    amount,
    assetId,
    commitment,
  };
}

// ============================================================================
// MAIN TEST
// ============================================================================
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("           The White Protocol v2 Withdraw Integration Test                   ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Initialize
  await initPoseidon();
  console.log("✓ Poseidon initialized");

  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );

  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log("✓ Authority:", authority.publicKey.toString());
  
  const balance = await connection.getBalance(authority.publicKey);
  console.log("✓ Balance:", (balance / LAMPORTS_PER_SOL).toFixed(4), "SOL");

  // Load on-chain state
  const merkleTreeAccount = await program.account.merkleTreeV2.fetch(CONFIG.MERKLE_TREE);
  const currentLeafIndex = merkleTreeAccount.nextLeafIndex;
  const onChainRoot = bytes32ToBigint(merkleTreeAccount.currentRoot);
  
  console.log("\n📊 On-chain State:");
  console.log("   Next leaf index:", currentLeafIndex);
  console.log("   Current root:", onChainRoot.toString(16).slice(0, 16) + "...");

  // Initialize local tree to match on-chain state
  const localTree = new LocalMerkleTree(CONFIG.MERKLE_DEPTH);
  
  // If there are existing leaves, we'd need to reconstruct - for test we assume fresh pool
  if (currentLeafIndex > 0) {
    console.log("\n⚠️  Pool has existing deposits. This test works best with a fresh pool.");
    console.log("   For a full test, the local tree needs to be reconstructed from events.");
  }

  // =========================================================================
  // STEP 1: Create Deposit
  // =========================================================================
  console.log("\n═══ STEP 1: Create Deposit ═══");
  
  const SOL_ASSET_ID = computeAssetId(NATIVE_MINT);
  const assetIdBigint = bytes32ToBigint(SOL_ASSET_ID);
  const depositAmount = BigInt(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL
  
  console.log("Deposit amount:", Number(depositAmount) / LAMPORTS_PER_SOL, "SOL");
  console.log("Asset ID:", SOL_ASSET_ID.toString("hex").slice(0, 20) + "...");

  const note = createDepositNote(depositAmount, assetIdBigint);
  console.log("Commitment:", note.commitment.toString(16).slice(0, 20) + "...");

  // Generate deposit proof
  console.log("\nGenerating deposit proof...");
  const depositInput = {
    secret: note.secret.toString(),
    nullifier: note.nullifier.toString(),
    amount: note.amount.toString(),
    asset_id: note.assetId.toString(),
    commitment: note.commitment.toString(),
  };

  const { proof: depositProof } = await snarkjs.groth16.fullProve(
    depositInput,
    CONFIG.DEPOSIT_WASM,
    CONFIG.DEPOSIT_ZKEY
  );
  console.log("✓ Deposit proof generated");

  // Serialize proof
  const depositProofBytes = new Uint8Array(256);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_a[0])), 0);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_a[1])), 32);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_b[0][1])), 64);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_b[0][0])), 96);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_b[1][1])), 128);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_b[1][0])), 160);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_c[0])), 192);
  depositProofBytes.set(bigintToBytes32BE(BigInt(depositProof.pi_c[1])), 224);

  // Submit deposit
  console.log("\nSubmitting deposit to pool...");
  
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_v2"), CONFIG.POOL_CONFIG.toBuffer(), SOL_ASSET_ID],
    CONFIG.PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), assetVault.toBuffer()],
    CONFIG.PROGRAM_ID
  );
  const [depositVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_deposit"), CONFIG.POOL_CONFIG.toBuffer()],
    CONFIG.PROGRAM_ID
  );

  // Create depositor's wrapped SOL account
  const depositorAta = getAssociatedTokenAddressSync(NATIVE_MINT, authority.publicKey);
  
  // Check if ATA exists, create if not
  const ataInfo = await connection.getAccountInfo(depositorAta);
  if (!ataInfo) {
    console.log("Creating depositor wSOL account...");
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      depositorAta,
      authority.publicKey,
      NATIVE_MINT
    );
    const tx = new Transaction().add(createAtaIx);
    await sendAndConfirmTransaction(connection, tx, [authority]);
  }

  // Wrap SOL
  console.log("Wrapping SOL...");
  const wrapTx = new Transaction();
  wrapTx.add(
    SystemProgram.transfer({
      fromPubkey: authority.publicKey,
      toPubkey: depositorAta,
      lamports: Number(depositAmount),
    }),
    createSyncNativeInstruction(depositorAta)
  );
  await sendAndConfirmTransaction(connection, wrapTx, [authority]);
  console.log("✓ SOL wrapped");

  // Submit deposit instruction
  try {
    const depositIx = await program.methods
      .depositMasp(
        new BN(depositAmount.toString()),
        Array.from(bigintToBytes32BE(note.commitment)),
        Array.from(SOL_ASSET_ID),
        Buffer.from(depositProofBytes),
        null // no encrypted note
      )
      .accounts({
        depositor: authority.publicKey,
        poolConfig: CONFIG.POOL_CONFIG,
        authority: authority.publicKey,
        merkleTree: CONFIG.MERKLE_TREE,
        assetVault: assetVault,
        vaultTokenAccount: vaultTokenAccount,
        userTokenAccount: depositorAta,
        mint: NATIVE_MINT,
        depositVk: depositVk,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }));
    tx.add(depositIx);
    
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
    console.log("✓ Deposit submitted:", sig.slice(0, 30) + "...");
  } catch (e: any) {
    console.log("❌ Deposit failed:", e.message);
    if (e.logs) e.logs.slice(-5).forEach((l: string) => console.log("  ", l));
    return;
  }

  // =========================================================================
  // STEP 2: Settle Batch (simulate sequencer)
  // =========================================================================
  console.log("\n═══ STEP 2: Settle Batch ═══");
  
  // Wait for deposit to be confirmed
  await sleep(2000);

  // Fetch pending buffer
  const pendingBuffer = await program.account.pendingDepositsBuffer.fetch(CONFIG.PENDING_BUFFER);
  console.log("Pending deposits:", pendingBuffer.totalPending);

  if (pendingBuffer.totalPending === 0) {
    console.log("⚠️  No pending deposits to settle");
    return;
  }

  // Get current state
  const merkleTreeBefore = await program.account.merkleTreeV2.fetch(CONFIG.MERKLE_TREE);
  const startIndex = merkleTreeBefore.nextLeafIndex;
  const oldRoot = bytes32ToBigint(merkleTreeBefore.currentRoot);

  // Add commitment to local tree to compute new root
  const assignedLeafIndex = localTree.insert(note.commitment);
  const newRoot = localTree.getRoot();

  console.log("Start index:", startIndex);
  console.log("Old root:", oldRoot.toString(16).slice(0, 16) + "...");
  console.log("New root:", newRoot.toString(16).slice(0, 16) + "...");

  // Generate batch proof
  console.log("\nGenerating batch settlement proof...");
  
  const batchSize = 1;
  const commitments = [note.commitment];
  
  // Compute commitments hash
  const commitmentsBuffer = Buffer.alloc(CONFIG.MAX_BATCH_SIZE * 32);
  for (let i = 0; i < batchSize; i++) {
    Buffer.from(bigintToBytes32BE(commitments[i])).copy(commitmentsBuffer, i * 32);
  }
  const commitmentsHashFull = createHash("sha256").update(commitmentsBuffer).digest();
  const commitmentsHashBigint = bytes32ToBigint(commitmentsHashFull);
  const mask = (1n << 253n) - 1n;
  const commitmentsHash = commitmentsHashBigint & mask;

  // Get merkle path for insertion
  const pathElements = localTree.getMerklePath(0).pathElements; // For first leaf

  // Pad for circuit
  const paddedCommitments = [...commitments];
  const paddedPaths = [pathElements];
  while (paddedCommitments.length < CONFIG.MAX_BATCH_SIZE) {
    paddedCommitments.push(0n);
    paddedPaths.push(new Array(CONFIG.MERKLE_DEPTH).fill(0n));
  }

  const batchInput = {
    oldRoot: oldRoot.toString(),
    newRoot: newRoot.toString(),
    startIndex: startIndex.toString(),
    batchSize: batchSize.toString(),
    commitmentsHash: commitmentsHash.toString(),
    commitments: paddedCommitments.map(c => c.toString()),
    pathElements: paddedPaths.map(p => p.map(e => e.toString())),
  };

  const { proof: batchProof } = await snarkjs.groth16.fullProve(
    batchInput,
    CONFIG.MERKLE_BATCH_WASM,
    CONFIG.MERKLE_BATCH_ZKEY
  );
  console.log("✓ Batch proof generated");

  // Serialize proof
  const batchProofBytes = new Uint8Array(256);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_a[0])), 0);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_a[1])), 32);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_b[0][1])), 64);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_b[0][0])), 96);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_b[1][1])), 128);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_b[1][0])), 160);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_c[0])), 192);
  batchProofBytes.set(bigintToBytes32BE(BigInt(batchProof.pi_c[1])), 224);

  // Submit batch settlement
  console.log("\nSubmitting batch settlement...");
  
  const [batchVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), CONFIG.POOL_CONFIG.toBuffer()],
    CONFIG.PROGRAM_ID
  );

  try {
    const settleIx = await program.methods
      .settleDepositsBatch({
        proof: Buffer.from(batchProofBytes),
        newRoot: Buffer.from(bigintToBytes32BE(newRoot)),
        batchSize: batchSize,
      })
      .accounts({
        authority: authority.publicKey,
        poolConfig: CONFIG.POOL_CONFIG,
        merkleTree: CONFIG.MERKLE_TREE,
        pendingBuffer: CONFIG.PENDING_BUFFER,
        verificationKey: batchVk,
      })
      .instruction();

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
    tx.add(settleIx);

    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
    console.log("✓ Batch settled:", sig.slice(0, 30) + "...");
  } catch (e: any) {
    console.log("❌ Batch settlement failed:", e.message);
    if (e.logs) e.logs.slice(-10).forEach((l: string) => console.log("  ", l));
    return;
  }

  // Update note with leaf index
  const fullNote: DepositNote = {
    ...note,
    leafIndex: assignedLeafIndex,
  };

  // Save note for later
  const notePath = "data/test-deposit-note.json";
  fs.writeFileSync(notePath, JSON.stringify({
    secret: fullNote.secret.toString(),
    nullifier: fullNote.nullifier.toString(),
    amount: fullNote.amount.toString(),
    assetId: fullNote.assetId.toString(),
    commitment: fullNote.commitment.toString(),
    leafIndex: fullNote.leafIndex,
  }, null, 2));
  console.log("✓ Deposit note saved to", notePath);

  // =========================================================================
  // STEP 3: Generate Withdraw Proof
  // =========================================================================
  console.log("\n═══ STEP 3: Generate Withdraw Proof ═══");
  
  // Get updated merkle root
  const merkleTreeAfter = await program.account.merkleTreeV2.fetch(CONFIG.MERKLE_TREE);
  const withdrawMerkleRoot = bytes32ToBigint(merkleTreeAfter.currentRoot);
  console.log("Merkle root for withdraw:", withdrawMerkleRoot.toString(16).slice(0, 16) + "...");

  // Compute nullifier hash (two-step Poseidon matching circuit)
  // nullifier_inner = Poseidon(nullifier, secret)
  const nullifierInner = poseidonHash([fullNote.nullifier, fullNote.secret]);
  // nullifier_hash = Poseidon(nullifier_inner, leaf_index)
  const nullifierHash = poseidonHash([nullifierInner, BigInt(fullNote.leafIndex)]);
  console.log("Nullifier hash:", nullifierHash.toString(16).slice(0, 16) + "...");

  // Get merkle path
  const { pathElements: withdrawPath, pathIndices } = localTree.getMerklePath(fullNote.leafIndex);

  // Recipient (use authority for test)
  const recipient = authority.publicKey;
  const recipientScalar = bytes32ToBigint(recipient.toBytes());

  // Relayer (use authority for test)
  const relayer = authority.publicKey;
  const relayerScalar = bytes32ToBigint(relayer.toBytes());
  const relayerFee = BigInt(0); // No fee for self-relay

  // Public data hash (0 for no metadata)
  const publicDataHash = 0n;

  const withdrawInput = {
    // Public inputs
    merkle_root: withdrawMerkleRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    asset_id: fullNote.assetId.toString(),
    recipient: recipientScalar.toString(),
    amount: fullNote.amount.toString(),
    relayer: relayerScalar.toString(),
    relayer_fee: relayerFee.toString(),
    public_data_hash: publicDataHash.toString(),
    
    // Private inputs
    secret: fullNote.secret.toString(),
    nullifier: fullNote.nullifier.toString(),
    leaf_index: fullNote.leafIndex.toString(),
    merkle_path: withdrawPath.map(p => p.toString()),
    merkle_path_indices: pathIndices.map(i => i.toString()),
  };

  console.log("\nGenerating withdraw proof...");
  const { proof: withdrawProof } = await snarkjs.groth16.fullProve(
    withdrawInput,
    CONFIG.WITHDRAW_WASM,
    CONFIG.WITHDRAW_ZKEY
  );
  console.log("✓ Withdraw proof generated");

  // Serialize proof
  const withdrawProofBytes = new Uint8Array(256);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_a[0])), 0);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_a[1])), 32);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_b[0][1])), 64);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_b[0][0])), 96);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_b[1][1])), 128);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_b[1][0])), 160);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_c[0])), 192);
  withdrawProofBytes.set(bigintToBytes32BE(BigInt(withdrawProof.pi_c[1])), 224);

  // =========================================================================
  // STEP 4: Submit Withdrawal
  // =========================================================================
  console.log("\n═══ STEP 4: Submit Withdrawal ═══");

  // Derive PDAs
  const [withdrawVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw"), CONFIG.POOL_CONFIG.toBuffer()],
    CONFIG.PROGRAM_ID
  );
  const [spentNullifier] = PublicKey.findProgramAddressSync(
    [Buffer.from("nullifier_v2"), CONFIG.POOL_CONFIG.toBuffer(), Buffer.from(bigintToBytes32BE(nullifierHash))],
    CONFIG.PROGRAM_ID
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), CONFIG.POOL_CONFIG.toBuffer()],
    CONFIG.PROGRAM_ID
  );
  const [relayerNode] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer"), relayerRegistry.toBuffer(), relayer.toBuffer()],
    CONFIG.PROGRAM_ID
  );

  // Token accounts
  const recipientAta = getAssociatedTokenAddressSync(NATIVE_MINT, recipient);
  const relayerAta = getAssociatedTokenAddressSync(NATIVE_MINT, relayer);

  console.log("Submitting withdrawal...");
  console.log("  Recipient:", recipient.toString().slice(0, 20) + "...");
  console.log("  Amount:", Number(fullNote.amount) / LAMPORTS_PER_SOL, "SOL");

  try {
    const withdrawIx = await program.methods
      .withdrawMasp(
        Buffer.from(withdrawProofBytes),
        Array.from(bigintToBytes32BE(withdrawMerkleRoot)),
        Array.from(bigintToBytes32BE(nullifierHash)),
        recipient,
        new BN(fullNote.amount.toString()),
        Array.from(SOL_ASSET_ID),
        new BN(relayerFee.toString())
      )
      .accountsStrict({
        relayer: relayer,
        pool_config: CONFIG.POOL_CONFIG,
        merkle_tree: CONFIG.MERKLE_TREE,
        vk_account: withdrawVk,
        asset_vault: assetVault,
        vault_token_account: vaultTokenAccount,
        recipient_token_account: recipientAta,
        relayer_token_account: relayerAta,
        spent_nullifier: spentNullifier,
        relayer_registry: relayerRegistry,
        relayer_node: relayerNode,
        token_program: TOKEN_PROGRAM_ID,
        system_program: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
    tx.add(withdrawIx);

    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
    console.log("✓ Withdrawal successful:", sig);
    
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("                    🎉 TEST PASSED! 🎉                          ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("\nFull privacy flow completed:");
    console.log("  1. ✅ Deposited", Number(depositAmount) / LAMPORTS_PER_SOL, "SOL");
    console.log("  2. ✅ Settled batch with ZK proof");
    console.log("  3. ✅ Generated withdrawal proof");
    console.log("  4. ✅ Withdrew funds privately");
    
  } catch (e: any) {
    console.log("❌ Withdrawal failed:", e.message);
    if (e.logs) {
      console.log("\nProgram logs:");
      e.logs.forEach((l: string) => console.log("  ", l));
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
