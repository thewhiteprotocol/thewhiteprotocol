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
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD");
const WRAPPED_SOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

function computeAssetId(mint: PublicKey, poolConfig: PublicKey): Buffer {
  const data = Buffer.concat([
    Buffer.from("asset_id"),
    mint.toBuffer(),
    poolConfig.toBuffer()
  ]);
  return crypto.createHash("sha256").update(data).digest();
}

async function main() {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/workspaces/thewhiteprotocol/devnet-deployer.json", "utf8")))
  );
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("white_pool"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const assetIdBytes = computeAssetId(WRAPPED_SOL_MINT, poolConfig);
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), poolConfig.toBuffer(), assetIdBytes],
    PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_token"), assetVault.toBuffer()],
    PROGRAM_ID
  );

  console.log("Pool:", poolConfig.toBase58());
  console.log("Asset Vault:", assetVault.toBase58());
  console.log("Vault Token:", vaultTokenAccount.toBase58());

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
    console.log("Success:", sig);
  } catch (e: any) {
    console.error("FULL ERROR:");
    console.error(e.message);
    if (e.logs) {
      console.error("LOGS:");
      for (const log of e.logs) console.error("  ", log);
    }
  }
}

main();
