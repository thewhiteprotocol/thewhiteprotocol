import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("DhxYqdgsMA2vF6JSvz3UuDBDVvtBa9wNE6WPh1W8nbn7");

async function main() {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("/workspaces/thewhiteprotocol/devnet-deployer.json", "utf8"))));
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log("Withdraw VK PDA:", vkPda.toBase58());

  // Check account state
  const acc = await connection.getAccountInfo(vkPda);
  if (acc) {
    console.log("Account exists, data length:", acc.data.length);
    console.log("is_locked byte at offset 42:", acc.data[42]);
    console.log("First 50 bytes hex:", acc.data.slice(0, 50).toString("hex"));
  }

  try {
    const ix = await program.methods
      .finalizeVkV2({ withdraw: {} })
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .instruction();

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
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
