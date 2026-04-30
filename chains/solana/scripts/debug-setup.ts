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
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("DAoezX29ingBicFfrqboD7xBeLro2b6RL77dhEbXivVD");

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
    [Buffer.from("pool_config"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree"), poolConfig.toBuffer()],
    PROGRAM_ID
  );

  try {
    const ix = await program.methods
      .initializePoolV2(20, 100)
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
