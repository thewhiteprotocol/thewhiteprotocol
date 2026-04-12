import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction, Connection, TransactionInstruction } from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("73MzPg5UFz869CA5XWaEFUYDoS8ezzmjtvARJDMkNSgw");
const AUTHORITY_MINT_TO_REMOVE = new PublicKey("J6HiqxWjWfcpPssVZHyb97rR5wFRFZmLaZYe1YrC1cSb");

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf-8")))
  );
  
  const [yieldRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("yield_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("Removing erroneous authority entry from yield registry...");
  
  const discriminator = crypto.createHash("sha256")
    .update("global:remove_yield_mint")
    .digest()
    .slice(0, 8);
  
  const data = Buffer.concat([discriminator, AUTHORITY_MINT_TO_REMOVE.toBuffer()]);
  
  const ix = new TransactionInstruction({
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_CONFIG, isSigner: false, isWritable: false },
      { pubkey: yieldRegistry, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data,
  });
  
  const tx = new Transaction().add(ix);
  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log("✓ Removed. TX:", sig);
}

main().catch(console.error);
