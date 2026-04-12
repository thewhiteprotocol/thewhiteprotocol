/**
 * Create Vault Token Account
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { NATIVE_MINT, createAssociatedTokenAccountInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";

const ASSET_VAULT = new PublicKey("FuVvYz3wM9naPD6GyohU4QpZypkX9G5oDYaNzAfCxyC5");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  
  const walletPath = process.env.HOME + "/.config/solana/pool-authority-v5.json";
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
  );

  const vaultTokenAccount = getAssociatedTokenAddressSync(NATIVE_MINT, ASSET_VAULT, true);
  
  console.log("Payer:", payer.publicKey.toString());
  console.log("Asset Vault:", ASSET_VAULT.toString());
  console.log("Vault Token Account:", vaultTokenAccount.toString());

  // Check if exists
  const acc = await connection.getAccountInfo(vaultTokenAccount);
  if (acc) {
    console.log("\n✅ Vault token account already exists");
    return;
  }

  // Create ATA
  console.log("\n🚀 Creating vault token account...");
  
  const tx = new Transaction().add(
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      vaultTokenAccount,
      ASSET_VAULT,
      NATIVE_MINT
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
  console.log("\n✅ Vault token account created!");
  console.log("Tx:", sig);
}

main().catch(console.error);
