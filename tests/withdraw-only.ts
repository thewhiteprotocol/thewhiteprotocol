/**
 * Withdraw-Only Test
 * Uses the saved deposit note to test withdrawal
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
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// @ts-ignore
const snarkjs = require("snarkjs");

const CONFIG = {
  PROGRAM_ID: new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb"),
  POOL_CONFIG: new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw"),
  MERKLE_TREE: new PublicKey("E1vS4WWQZ6j3jrbtr9gE8yotTAVqq1HNqEWN7ybjC8s3"),
  MERKLE_DEPTH: 20,
  WITHDRAW_WASM: path.join(__dirname, "../circuits/build/withdraw_js/withdraw.wasm"),
  WITHDRAW_ZKEY: path.join(__dirname, "../circuits/build/withdraw.zkey"),
};

let poseidon: any, F: any;

async function initPoseidon() {
  const circomlibjs = await import("circomlibjs");
  poseidon = await circomlibjs.buildPoseidon();
  F = poseidon.F;
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((x: bigint) => F.e(x)));
  return F.toObject(hash);
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
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}

// Convert pubkey to scalar matching Rust: scalar[1..32] = pubkey[0..31]
function pubkeyToScalar(pubkey: PublicKey): bigint {
  const bytes = pubkey.toBytes();
  const scalar = new Uint8Array(32);
  scalar[0] = 0; // Leading zero
  for (let i = 0; i < 31; i++) {
    scalar[i + 1] = bytes[i];
  }
  return bytes32ToBigint(scalar);
}

function computeAssetId(mint: PublicKey): Buffer {
  const keccak = require("js-sha3").keccak256;
  const prefix = Buffer.from("white:asset_id:v1");
  const combined = Buffer.concat([prefix, mint.toBuffer()]);
  const hash = Buffer.from(keccak(combined), "hex");
  const assetId = Buffer.alloc(32);
  assetId[0] = 0x00;
  hash.copy(assetId, 1, 0, 31);
  return assetId;
}

// Local Merkle Tree with only the settled deposit
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
    if (this.leaves.length === 0) return this.zeros[this.depth];
    let level = [...this.leaves];
    const size = 1 << this.depth;
    while (level.length < size) level.push(0n);
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
    while (level.length < size) level.push(0n);
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

  insert(commitment: bigint) { this.leaves.push(commitment); }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("           The White Protocol v2 Withdraw-Only Test                          ");
  console.log("═══════════════════════════════════════════════════════════════\n");

  await initPoseidon();
  console.log("✓ Poseidon initialized");

  // Load saved note
  const noteData = JSON.parse(fs.readFileSync("data/test-deposit-note.json", "utf8"));
  const note = {
    secret: BigInt(noteData.secret),
    nullifier: BigInt(noteData.nullifier),
    amount: BigInt(noteData.amount),
    assetId: BigInt(noteData.assetId),
    commitment: BigInt(noteData.commitment),
    leafIndex: noteData.leafIndex,
  };
  console.log("✓ Loaded deposit note");
  console.log("  Amount:", Number(note.amount) / LAMPORTS_PER_SOL, "SOL");
  console.log("  Leaf Index:", note.leafIndex);

  // Setup
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );
  const connection = new anchor.web3.Connection(process.env.ANCHOR_PROVIDER_URL!, "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  // Get on-chain merkle root
  const merkleTreeAccount = await program.account.merkleTreeV2.fetch(CONFIG.MERKLE_TREE);
  const onChainRoot = bytes32ToBigint(merkleTreeAccount.currentRoot);
  console.log("\n✓ On-chain root:", onChainRoot.toString(16).slice(0, 16) + "...");

  // Rebuild local tree with the settled commitment
  const localTree = new LocalMerkleTree(CONFIG.MERKLE_DEPTH);
  localTree.insert(note.commitment);
  const localRoot = localTree.getRoot();
  console.log("✓ Local root:   ", localRoot.toString(16).slice(0, 16) + "...");

  if (localRoot !== onChainRoot) {
    console.log("\n⚠️  ROOT MISMATCH!");
    console.log("This means more deposits were settled than just our note.");
    console.log("For this test, we need the local tree to match on-chain.");
    return;
  }
  console.log("✓ Roots match!");

  // Compute nullifier hash (two-step Poseidon)
  const nullifierInner = poseidonHash([note.nullifier, note.secret]);
  const nullifierHash = poseidonHash([nullifierInner, BigInt(note.leafIndex)]);
  console.log("\n✓ Nullifier hash:", nullifierHash.toString(16).slice(0, 16) + "...");

  // Get merkle path
  const { pathElements, pathIndices } = localTree.getMerklePath(note.leafIndex);

  // Recipient & relayer
  const recipient = authority.publicKey;
  const relayer = authority.publicKey;
  const relayerFee = 0n;
  const recipientScalar = pubkeyToScalar(recipient);
  const relayerScalar = pubkeyToScalar(relayer);

  // Build withdraw input
  const withdrawInput = {
    merkle_root: onChainRoot.toString(),
    nullifier_hash: nullifierHash.toString(),
    asset_id: note.assetId.toString(),
    recipient: recipientScalar.toString(),
    amount: note.amount.toString(),
    relayer: relayerScalar.toString(),
    relayer_fee: relayerFee.toString(),
    public_data_hash: "0",
    secret: note.secret.toString(),
    nullifier: note.nullifier.toString(),
    leaf_index: note.leafIndex.toString(),
    merkle_path: pathElements.map(p => p.toString()),
    merkle_path_indices: pathIndices.map(i => i.toString()),
  };

  console.log("\n═══ Generating Withdraw Proof ═══");
  console.log("This may take 30-60 seconds...");
  
  try {
    const { proof } = await snarkjs.groth16.fullProve(
      withdrawInput,
      CONFIG.WITHDRAW_WASM,
      CONFIG.WITHDRAW_ZKEY
    );
    console.log("✓ Withdraw proof generated!");

    // Serialize proof
    const proofBytes = new Uint8Array(256);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_a[0])), 0);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_a[1])), 32);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_b[0][1])), 64);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_b[0][0])), 96);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_b[1][1])), 128);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_b[1][0])), 160);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_c[0])), 192);
    proofBytes.set(bigintToBytes32BE(BigInt(proof.pi_c[1])), 224);

    console.log("\n═══ Submitting Withdrawal ═══");

    const SOL_ASSET_ID = computeAssetId(NATIVE_MINT);
    
    // Derive PDAs
    const [assetVault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_v2"), CONFIG.POOL_CONFIG.toBuffer(), SOL_ASSET_ID],
      CONFIG.PROGRAM_ID
    );
    const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token"), assetVault.toBuffer()],
      CONFIG.PROGRAM_ID
    );
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

    const recipientAta = getAssociatedTokenAddressSync(NATIVE_MINT, recipient);
    const relayerAta = getAssociatedTokenAddressSync(NATIVE_MINT, relayer);

    const withdrawIx = await program.methods
      .withdrawMasp(
        Buffer.from(proofBytes),
        Array.from(bigintToBytes32BE(onChainRoot)),
        Array.from(bigintToBytes32BE(nullifierHash)),
        recipient,
        new BN(note.amount.toString()),
        Array.from(SOL_ASSET_ID),
        new BN(relayerFee.toString())
      )
      .accounts({
        relayer: relayer,
        poolConfig: CONFIG.POOL_CONFIG,
        merkleTree: CONFIG.MERKLE_TREE,
        vkAccount: withdrawVk,
        assetVault: assetVault,
        vaultTokenAccount: vaultTokenAccount,
        recipientTokenAccount: recipientAta,
        relayerTokenAccount: relayerAta,
        spentNullifier: spentNullifier,
        relayerRegistry: relayerRegistry,
        relayerNode: relayerNode,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
    tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }));
    tx.add(withdrawIx);

    const sig = await sendAndConfirmTransaction(connection, tx, [authority], { commitment: "confirmed" });
    
    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("                    🎉 WITHDRAWAL SUCCESS! 🎉                   ");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("TX:", sig);
    console.log("Amount:", Number(note.amount) / LAMPORTS_PER_SOL, "SOL");

  } catch (e: any) {
    console.log("\n❌ Error:", e.message);
    if (e.logs) {
      console.log("\nProgram logs:");
      e.logs.forEach((l: string) => console.log("  ", l));
    }
  }
}

main().catch(console.error);
