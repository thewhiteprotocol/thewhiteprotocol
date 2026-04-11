import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc");

function decimalToBytes32BE(dec: string): number[] {
  let hex = BigInt(dec).toString(16).padStart(64, "0");
  const bytes: number[] = [];
  for (let i = 0; i < 64; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
  return bytes;
}

function g1ToBytes(point: string[]): number[] {
  return [...decimalToBytes32BE(point[0]), ...decimalToBytes32BE(point[1])];
}

function g2ToBytes(point: string[][]): number[] {
  const x0 = decimalToBytes32BE(point[0][0]);
  const x1 = decimalToBytes32BE(point[0][1]);
  const y0 = decimalToBytes32BE(point[1][0]);
  const y1 = decimalToBytes32BE(point[1][1]);
  return [...x1, ...x0, ...y1, ...y0]; // c1 (imaginary) FIRST
}

async function main() {
  const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8"))));
  const connection = new anchor.web3.Connection("https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343", "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, {});
  const idl = JSON.parse(fs.readFileSync("/workspaces/white-protocol-v2/target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  const vk = JSON.parse(fs.readFileSync("/workspaces/white-protocol-v2/circuits/build/deposit_vk.json", "utf8"));
  const [vkPda] = PublicKey.findProgramAddressSync([Buffer.from("vk"), POOL_CONFIG.toBuffer(), Buffer.from("deposit")], PROGRAM_ID);

  console.log("Authority:", authority.publicKey.toString());
  console.log("VK PDA:", vkPda.toString());

  const alphaG1 = g1ToBytes(vk.vk_alpha_1);
  const betaG2 = g2ToBytes(vk.vk_beta_2);
  const gammaG2 = g2ToBytes(vk.vk_gamma_2);
  const deltaG2 = g2ToBytes(vk.vk_delta_2);
  const icPoints = vk.IC.map((ic: string[]) => g1ToBytes(ic));

  // Init
  try {
    const tx = await program.methods.initVkV2({ deposit: {} }, alphaG1, betaG2, gammaG2, deltaG2, icPoints.length)
      .accountsStrict({ authority: authority.publicKey, poolConfig: POOL_CONFIG, vkAccount: vkPda, systemProgram: anchor.web3.SystemProgram.programId })
      .rpc();
    console.log("✅ Init:", tx.slice(0, 30));
  } catch (e: any) { console.log("Init:", e.message?.slice(0, 50)); }

  await new Promise(r => setTimeout(r, 2000));

  // IC
  for (let i = 0; i < icPoints.length; i += 4) {
    const chunk = icPoints.slice(i, Math.min(i + 4, icPoints.length));
    try {
      const tx = await program.methods.appendVkIcV2({ deposit: {} }, chunk)
        .accountsStrict({ authority: authority.publicKey, poolConfig: POOL_CONFIG, vkAccount: vkPda })
        .rpc();
      console.log(`  IC ${i}-${i+chunk.length-1}:`, tx.slice(0, 20));
    } catch (e: any) { console.log("  IC error:", e.message?.slice(0, 50)); }
    await new Promise(r => setTimeout(r, 1500));
  }

  // Finalize
  try {
    const tx = await program.methods.finalizeVkV2({ deposit: {} })
      .accountsStrict({ authority: authority.publicKey, poolConfig: POOL_CONFIG, vkAccount: vkPda })
      .rpc();
    console.log("✅ Finalized:", tx.slice(0, 30));
  } catch (e: any) { console.log("Finalize:", e.message?.slice(0, 50)); }
}

main().catch(console.error);
