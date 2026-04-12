import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const POOL_CONFIG = new PublicKey("iWMNRMHKS6zFKaNX1WkCBD3vsdnW4L24qd5Cp7sgLRV");
const MERKLE_TREE = new PublicKey("BhyDXxA7WT5WX7WgbGvqThpUjK8QXDSk891nhfKd32Lv");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = JSON.parse(require("fs").readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  
  console.log("Authority:", provider.wallet.publicKey.toBase58());
  console.log("Resetting merkle tree...");
  
  const tx = await program.methods
    .resetMerkleTree()
    .accounts({
      authority: provider.wallet.publicKey,
      poolConfig: POOL_CONFIG,
      merkleTree: MERKLE_TREE,
    })
    .rpc();
  
  console.log("✅ Reset! Tx:", tx);
}

main().catch(console.error);
