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
    [Buffer.from("white_pool"), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), poolConfig.toBuffer()],
    PROGRAM_ID
  );
  const [complianceConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("compliance_config"), poolConfig.toBuffer()],
    PROGRAM_ID
  );

  console.log("Pool:", poolConfig.toBase58());
  console.log("Relayer:", relayerRegistry.toBase58());
  console.log("Compliance:", complianceConfig.toBase58());

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
