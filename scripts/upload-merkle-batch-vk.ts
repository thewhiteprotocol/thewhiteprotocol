import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("uKWvwEoqd46PHeDQHbmrp4gXTgvWBxu7VeWXgFUE9zc");

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
  return [...x_c1, ...x_c0, ...y_c1, ...y_c0]; // c1 FIRST
}

async function main() {
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_WALLET!, "utf8")))
  );
  const connection = new anchor.web3.Connection("https://devnet.helius-rpc.com/?api-key=2f0116cb-6972-4a3d-bb9e-43de29619343", "confirmed");
  const wallet = new anchor.Wallet(authority);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  
  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log("Authority:", authority.publicKey.toBase58());
  console.log("Pool:", POOL_CONFIG.toBase58());

  const vkJson = JSON.parse(fs.readFileSync("circuits/build/merkle_batch_update/verification_key.json", "utf8"));
  
  const alphaG1 = Array.from(Buffer.from(g1ToBytes(vkJson.vk_alpha_1)));
  const betaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_beta_2)));
  const gammaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_gamma_2)));
  const deltaG2 = Array.from(Buffer.from(g2ToBytes(vkJson.vk_delta_2)));
  const icPoints = vkJson.IC.map((ic: string[]) => Array.from(Buffer.from(g1ToBytes(ic))));

  console.log("IC count:", icPoints.length);

  const [vkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );
  console.log("VK PDA:", vkPda.toBase58());

  const tx = await program.methods
    .setVerificationKeyV2({ merkleBatchUpdate: {} }, alphaG1, betaG2, gammaG2, deltaG2, icPoints)
    .accounts({
      authority: authority.publicKey,
      poolConfig: POOL_CONFIG,
      vkAccount: vkPda,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  console.log("✅ VK uploaded:", tx);
}

main().catch(console.error);
