/**
 * Production Relayer Reset Script
 *
 * 1. Resets the on-chain Merkle tree to empty state
 * 2. Clears the on-chain pending deposits buffer
 * 3. Clears local relayer state files (merkle-tree-state.json, pending-state.json, settled-commitments.json)
 *
 * Run from repo root:
 *   cd chains/solana && npx tsx scripts/reset-production-relayer.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Current devnet deployment PDAs (from relayer/.env.example)
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");
const MERKLE_TREE = new PublicKey("2DjfHs3CYK22a4SAMSH2gt6eXRwSnBzm2f4gWvmos8sD");
const PENDING_BUFFER = new PublicKey("7MzDFCdPEog6orC42jCXBz53zhqysQVq5vb5J7R1DAyw");

// Local relayer state files to clear
const RELAYER_DATA_DIR = path.join(process.cwd(), "..", "..", "relayer", "data");
const FILES_TO_CLEAR = [
  "merkle-tree-state.json",
  "pending-state.json",
  "settled-commitments.json",
];

async function main() {
  let provider: anchor.AnchorProvider;

  if (process.env.ANCHOR_PROVIDER_URL && process.env.ANCHOR_WALLET) {
    provider = anchor.AnchorProvider.env();
  } else {
    // Fallback: create provider manually from default Solana keypair
    const walletPath = path.join(process.env.HOME || '', '.config/solana/id.json');
    if (!fs.existsSync(walletPath)) {
      throw new Error(`No wallet found at ${walletPath}. Set ANCHOR_WALLET or ensure Solana CLI keypair exists.`);
    }
    const keypair = anchor.web3.Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
    );
    const wallet = new anchor.Wallet(keypair);
    const connection = new anchor.web3.Connection('https://api.devnet.solana.com', 'confirmed');
    provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  }

  anchor.setProvider(provider);

  const idlPath = path.join(__dirname, "..", "target", "idl", "white_protocol.json");
  if (!fs.existsSync(idlPath)) {
    console.error("IDL not found at:", idlPath);
    console.error("Make sure the program has been built (anchor build).");
    process.exit(1);
  }

  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(idl, provider);

  const authority = provider.wallet.publicKey;
  console.log("Authority:", authority.toBase58());
  console.log("Pool Config:", POOL_CONFIG.toBase58());
  console.log("Merkle Tree:", MERKLE_TREE.toBase58());
  console.log("Pending Buffer:", PENDING_BUFFER.toBase58());
  console.log("");

  // 1. Reset Merkle tree
  console.log("Step 1/3: Resetting Merkle tree...");
  const txReset = await (program.methods as any)
    .resetMerkleTree()
    .accounts({
      authority,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
    })
    .rpc();
  console.log("✅ Merkle tree reset! Tx:", txReset);

  // 2. Clear pending buffer
  console.log("Step 2/3: Clearing pending buffer...");
  const txClear = await (program.methods as any)
    .clearPendingBuffer()
    .accounts({
      authority,
      poolConfig: POOL_CONFIG,
      pendingBuffer: PENDING_BUFFER,
    })
    .rpc();
  console.log("✅ Pending buffer cleared! Tx:", txClear);

  // 3. Clear local relayer state files
  console.log("Step 3/3: Clearing local relayer state files...");
  const dataDir = path.resolve(RELAYER_DATA_DIR);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  for (const filename of FILES_TO_CLEAR) {
    const filePath = path.join(dataDir, filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`  🗑️  Removed ${filename}`);
    } else {
      console.log(`  ⚪ ${filename} (not present)`);
    }
  }

  // Write empty settled-commitments.json so the relayer knows it's a fresh start
  const settledPath = path.join(dataDir, "settled-commitments.json");
  fs.writeFileSync(settledPath, JSON.stringify({ commitments: [] }, null, 2));
  console.log("  📝 Created empty settled-commitments.json");

  console.log("");
  console.log("🚀 Relayer reset complete! Next steps:");
  console.log("   1. Restart the relayer service (it will start with a fresh empty tree)");
  console.log("   2. Make a new deposit");
  console.log("   3. Verify auto-settlement within ~30 seconds");
}

main().catch((err) => {
  console.error("❌ Reset failed:", err);
  process.exit(1);
});
