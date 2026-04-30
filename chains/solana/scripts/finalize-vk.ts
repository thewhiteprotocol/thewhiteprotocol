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

const PROGRAM_ID = new PublicKey("DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD");
const POOL_CONFIG = new PublicKey("DZLJU6MAeWZ7aGLyt2j7Jq2XnNq2ch6jUAVgKmki9HaF");

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

  const [withdrawVk] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_withdraw"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  console.log("Withdraw VK:", withdrawVk.toBase58());

  try {
    const ix = await program.methods
      .finalizeVkV2({ withdraw: {} })
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: withdrawVk,
      })
      .instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("✅ Finalize success:", sig);
  } catch (e: any) {
    console.error("Error:", e.message);
    if (e.logs) for (const log of e.logs) console.error("  ", log);
  }
}

main();
