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
    [Buffer.from("vk_withdraw_v2"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log("WithdrawV2 VK PDA:", vkPda.toBase58());

  // Try to close it first
  try {
    const ix = await program.methods
      .closeVkV2({ withdrawV2: {} })
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("Close success:", sig);
  } catch (e: any) {
    console.log("Close failed (may not exist or not initialized):", e.message?.slice(0, 100));
  }

  // Now try to reinitialize and finalize
  const vkJson = JSON.parse(fs.readFileSync("../../circuits/withdraw_v2/build/withdraw_v2_vk.json", "utf8"));

  function decimalToBytes32BE(decimal: string): number[] {
    const bn = BigInt(decimal);
    const hex = bn.toString(16).padStart(64, "0");
    const bytes: number[] = [];
    for (let i = 0; i < 64; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return bytes;
  }
  function g1ToBytes(point: string[]): number[] {
    return [...decimalToBytes32BE(point[0]), ...decimalToBytes32BE(point[1])];
  }
  function g2ToBytes(point: string[][]): number[] {
    const x_c0 = decimalToBytes32BE(point[0][0]);
    const x_c1 = decimalToBytes32BE(point[0][1]);
    const y_c0 = decimalToBytes32BE(point[1][0]);
    const y_c1 = decimalToBytes32BE(point[1][1]);
    return [...x_c1, ...x_c0, ...y_c1, ...y_c0];
  }

  const alphaG1 = g1ToBytes(vkJson.vk_alpha_1);
  const betaG2 = g2ToBytes(vkJson.vk_beta_2);
  const gammaG2 = g2ToBytes(vkJson.vk_gamma_2);
  const deltaG2 = g2ToBytes(vkJson.vk_delta_2);
  const icPoints = vkJson.IC.map((ic: string[]) => g1ToBytes(ic));

  try {
    let ix = await program.methods
      .initializeVkV2({ withdrawV2: {} }, alphaG1, betaG2, gammaG2, deltaG2, 13)
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
    let tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      ix
    );
    let sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("Init success:", sig);
  } catch (e: any) {
    console.error("Init failed:", e.message);
    if (e.logs) for (const log of e.logs) console.error("  ", log);
    return;
  }

  const chunkSize = 3;
  for (let i = 0; i < icPoints.length; i += chunkSize) {
    const chunk = icPoints.slice(i, i + chunkSize);
    try {
      const ix = await program.methods
        .appendVkIcV2({ withdrawV2: {} }, chunk)
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
      console.log(`IC ${i}-${i + chunk.length - 1} success:`, sig.slice(0, 20));
    } catch (e: any) {
      console.error(`IC ${i} failed:`, e.message);
      if (e.logs) for (const log of e.logs) console.error("  ", log);
    }
  }

  try {
    const ix = await program.methods
      .finalizeVkV2({ withdrawV2: {} })
      .accountsStrict({
        authority: authority.publicKey,
        poolConfig: POOL_CONFIG,
        vkAccount: vkPda,
      })
      .instruction();
    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
      ix
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log("Finalize success:", sig);
  } catch (e: any) {
    console.error("Finalize failed:", e.message);
    if (e.logs) for (const log of e.logs) console.error("  ", log);
  }
}

main();
