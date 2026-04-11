import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { readFileSync } from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  const authority = provider.wallet.publicKey;

  const [poolConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_v2"), authority.toBuffer()],
    PROGRAM_ID
  );

  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from("merkle_tree_v2"), poolConfig.toBuffer()],
    PROGRAM_ID
  );

  // Minimum allowed: depth 4 = 16 notes
  const treeDepth = 20;
  const rootHistorySize = 30;

  console.log("=== The White Protocol v2 Pool Initialization ===");
  console.log("Depth:", treeDepth, "=", Math.pow(2, treeDepth), "notes");

  try {
    const modifyComputeUnits = ComputeBudgetProgram.setComputeUnitLimit({
      units: 1_400_000
    });

    const tx = await (program.methods as any)
      .initializePoolV2(treeDepth, rootHistorySize)
      .accounts({
        authority: authority,
        poolConfig: poolConfig,
        merkleTree: merkleTree,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([modifyComputeUnits])
      .rpc();

    console.log("\n✓ Pool initialized!");
    console.log("Tx:", tx);
    console.log("Pool:", poolConfig.toString());
    console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (e: any) {
    console.error("Error:", e.message?.slice(0, 300) || e);
  }
}

main().catch(console.error);
