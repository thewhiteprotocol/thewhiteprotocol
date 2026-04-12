/**
 * Register wSOL Asset - New Deployment
 * Program ID: C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { keccak_256 } from "@noble/hashes/sha3.js";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

function computeAssetId(mint: PublicKey): Buffer {
  const prefix = Buffer.from("white:asset_id:v1");
  const mintBytes = mint.toBuffer();
  const combined = Buffer.concat([prefix, mintBytes]);
  const hash = Buffer.from(keccak_256(combined));
  const assetId = Buffer.alloc(32);
  assetId[0] = 0x00;
  hash.copy(assetId, 1, 0, 31);
  return assetId;
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(require("fs").readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl as any, provider);
  const authority = provider.wallet.publicKey;

  // Compute asset ID for wSOL
  const assetId = computeAssetId(new PublicKey("So11111111111111111111111111111111111111112"));
  console.log("NATIVE_MINT:", NATIVE_MINT.toString());
  console.log("Asset ID:", assetId.toString("hex"));

  // Derive PDAs
  const [assetVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), POOL_CONFIG.toBuffer(), assetId],
    PROGRAM_ID
  );

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("           Registering wSOL Asset");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log("Authority:", authority.toString());
  console.log("Pool Config:", POOL_CONFIG.toString());
  console.log("Asset Vault:", assetVault.toString());

  try {
    const tx = await (program.methods as any)
      .registerAsset([...assetId])
      .accounts({
        authority: authority,
        poolConfig: POOL_CONFIG,
        assetVault: assetVault,
        mint: new PublicKey("So11111111111111111111111111111111111111112"),
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
      .rpc();
    
    console.log("\n✅ wSOL registered successfully!");
    console.log("Tx:", tx);
    console.log(`https://explorer.solana.com/tx/${tx}?cluster=devnet`);
  } catch (e: any) {
    console.error("\nError:", e.message?.slice(0, 300) || e);
    if (e.logs) console.error("Logs:", e.logs.slice(-10));
  }
}

main().catch(console.error);
