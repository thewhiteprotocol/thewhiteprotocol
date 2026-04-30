import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
// Program ID: env var override for localnet keypair mismatch, otherwise canonical from IDL
const idlPath = process.env.IDL_PATH || "target/idl/white_protocol.json";
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
const PROGRAM_ID = new PublicKey(process.env.PROGRAM_ID || idl.address);
const WRAPPED_SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const TREE_DEPTH = 20;
const ROOT_HISTORY_SIZE = 100;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "http://localhost:8899";
  const connection = new Connection(rpcUrl, "confirmed");
  const walletPath = process.env.ANCHOR_WALLET || "/workspaces/thewhiteprotocol/devnet-deployer.json";
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
  );
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  // Override IDL address so Anchor uses the correct program ID (e.g. localnet keypair)
  (idl as any).address = PROGRAM_ID.toBase58();
  const program = new anchor.Program(idl, provider);

  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Balance:", (await connection.getBalance(authority.publicKey)) / 1e9, "SOL\n");

  // Derive PDAs
  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("white_pool"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [pendingBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [complianceConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance"), poolConfig.toBuffer()],
    PROGRAM_ID
  );

  console.log("Pool Config:", poolConfig.toBase58());
  console.log("Merkle Tree:", merkleTree.toBase58());
  console.log("Pending Buffer:", pendingBuffer.toBase58());
  console.log("Relayer Registry:", relayerRegistry.toBase58());
  console.log("Compliance Config:", complianceConfig.toBase58());

  // Initialize Pool V2
  try {
    const ix = await program.methods
      .initializePoolV2(TREE_DEPTH, ROOT_HISTORY_SIZE)
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        merkleTree,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ Pool initialized:", sig.slice(0, 20) + "...");
  } catch (e: any) {
    console.log("Pool init:", e.message?.slice(0, 100));
  }
  await sleep(1000);

  // Initialize Pool Registries
  try {
    const ix = await program.methods
      .initializePoolRegistries()
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        relayerRegistry,
        complianceConfig,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ Registries initialized:", sig.slice(0, 20) + "...");
  } catch (e: any) {
    console.log("Registries init:", e.message?.slice(0, 100));
  }
  await sleep(1000);

  // Initialize Pending Deposits Buffer
  try {
    const ix = await program.methods
      .initializePendingDepositsBuffer()
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        pendingBuffer,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ Pending buffer initialized:", sig.slice(0, 20) + "...");
  } catch (e: any) {
    console.log("Pending buffer init:", e.message?.slice(0, 100));
  }
  await sleep(1000);

  // Register wSOL
  const { deriveAssetId } = await import('../sdk/src/crypto/keccak');
  const assetIdBytes = deriveAssetId(WRAPPED_SOL_MINT);
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolConfig.toBuffer(), assetIdBytes],
    PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), assetVault.toBuffer()],
    PROGRAM_ID
  );

  try {
    const ix = await program.methods
      .registerAsset(Array.from(assetIdBytes))
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig,
        mint: WRAPPED_SOL_MINT,
        assetVault,
        vaultTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ wSOL registered:", sig.slice(0, 20) + "...");
  } catch (e: any) {
    console.log("wSOL register:", e.message?.slice(0, 100));
  }

  console.log("\n🎉 Localnet setup complete!");
  console.log("POOL_CONFIG=" + poolConfig.toBase58());
  console.log("MERKLE_TREE=" + merkleTree.toBase58());
  console.log("PENDING_DEPOSITS=" + pendingBuffer.toBase58());
  console.log("ASSET_VAULT=" + assetVault.toBase58());
  console.log("VAULT_TOKEN_ACCOUNT=" + vaultTokenAccount.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
