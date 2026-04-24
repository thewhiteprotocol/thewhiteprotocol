import fs from "fs";
import path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

const RPC = "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("DbYzCrBEt1Efxf9LB2P7A6vqPjuA8ugDBh1kCunESJZk");
const POOL_CONFIG = new PublicKey("5tiLj9YYhsc28h1JVVBBeUmUKmwTEUEnzn7q86NNso6q");
const WALLET_PATH = "/home/codespace/.config/solana/id.json";
const ROOT = process.cwd();
const IDL_PATH = path.join(ROOT, "chains/solana/target/idl/white_protocol.json");

function disc(name) {
  const hash = require('crypto').createHash('sha256').update('global:' + name).digest();
  return hash.slice(0, 8);
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

  // Feature flags from PoolConfig:
  // FEATURE_MASP = 1 << 0 = 1 (already enabled)
  // FEATURE_JOIN_SPLIT = 1 << 1 = 2
  // FEATURE_MEMBERSHIP = 1 << 2 = 4
  // FEATURE_SHIELDED_CPI = 1 << 3 = 8
  // FEATURE_COMPLIANCE = 1 << 4 = 16
  // FEATURE_YIELD_ENFORCEMENT = 1 << 5 = 32

  const features = [
    { name: 'FEATURE_JOIN_SPLIT', value: 2 },
    { name: 'FEATURE_MEMBERSHIP', value: 4 },
    { name: 'FEATURE_SHIELDED_CPI', value: 8 },
    { name: 'FEATURE_COMPLIANCE', value: 16 },
  ];

  for (const feature of features) {
    console.log(`\n--- Enabling ${feature.name} (${feature.value}) ---`);
    try {
      const tx = await program.methods
        .enableFeature(feature.value)
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: POOL_CONFIG,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`${feature.name} enabled:`, tx);
    } catch (err) {
      console.log(`Error enabling ${feature.name}:`, err.message);
    }
  }

  // Initialize yield registry
  console.log(`\n--- Initializing Yield Registry ---`);
  const [yieldRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from('yield_registry'), POOL_CONFIG.toBuffer()],
    PROGRAM_ID,
  );
  console.log('YieldRegistry PDA:', yieldRegistry.toBase58());

  try {
    const existing = await connection.getAccountInfo(yieldRegistry);
    if (existing) {
      console.log('YieldRegistry already exists, skipping');
    } else {
      const tx = await program.methods
        .initYieldRegistry()
        .accountsStrict({
          authority: authority.publicKey,
          poolConfig: POOL_CONFIG,
          yieldRegistry,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      console.log('YieldRegistry initialized:', tx);
    }
  } catch (err) {
    console.log('Error initializing YieldRegistry:', err.message);
  }

  console.log("\n✅ Feature flags and yield registry done!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
