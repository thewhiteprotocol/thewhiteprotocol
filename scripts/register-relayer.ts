import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, ComputeBudgetProgram } from "@solana/web3.js";
import * as fs from "fs";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("iWMNRMHKS6zFKaNX1WkCBD3vsdnW4L24qd5Cp7sgLRV");
const REGISTER_RELAYER_DISCRIMINATOR = Buffer.from([98, 213, 0, 0, 27, 134, 109, 48]);

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const authority = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(".keys/pool-authority-v8.json", "utf8")))
  );

  console.log("Authority:", authority.publicKey.toString());

  const [relayerRegistry] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer_registry"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  const [relayerNode] = PublicKey.findProgramAddressSync(
    [Buffer.from("relayer"), relayerRegistry.toBuffer(), authority.publicKey.toBuffer()],
    PROGRAM_ID
  );

  console.log("Relayer Registry:", relayerRegistry.toString());
  console.log("Relayer Node PDA:", relayerNode.toString());

  const existing = await connection.getAccountInfo(relayerNode);
  if (existing) {
    console.log("✓ Relayer already registered");
    return;
  }

  // Args: fee_bps (u16) + metadata_uri (string = u32 len + bytes)
  const feeBps = Buffer.alloc(2);
  feeBps.writeUInt16LE(50, 0); // 0.5%

  const metadataUri = "https://api.whitprotocol.org";
  const metadataBytes = Buffer.from(metadataUri, "utf8");
  const metadataLen = Buffer.alloc(4);
  metadataLen.writeUInt32LE(metadataBytes.length, 0);

  const data = Buffer.concat([REGISTER_RELAYER_DISCRIMINATOR, feeBps, metadataLen, metadataBytes]);

  const ix = {
    programId: PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: POOL_CONFIG, isSigner: false, isWritable: false },
      { pubkey: relayerRegistry, isSigner: false, isWritable: true },
      { pubkey: relayerNode, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: data,
  };

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }));
  tx.add(ix);

  const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
  console.log("✅ Relayer registered:", sig);
}

main().catch(console.error);
