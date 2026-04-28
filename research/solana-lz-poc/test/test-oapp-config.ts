/**
 * Stub: TypeScript test for querying a Solana OApp's DVN configuration.
 *
 * To run fully:
 *   npm install @solana/web3.js @layerzerolabs/lz-solana-sdk-v2
 *   npx ts-node test-oapp-config.ts
 */

import { Connection, PublicKey } from "@solana/web3.js";

// Solana devnet endpoint
const DEVNET_RPC = "https://api.devnet.solana.com";

// LayerZero Solana Endpoint program (mainnet & devnet)
const LZ_ENDPOINT_PROGRAM = new PublicKey(
  "76y77prsiCMvXMjuoZ5VRrhG5qYBrUMYTE5WgHqgjEn6"
);

// Example OApp Store PDA on devnet (replace with actual deployed address)
const OAPP_STORE = new PublicKey(
  "C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW"
);

// Destination EID (e.g., Ethereum mainnet = 30101)
const DST_EID = 30101;

async function main() {
  const connection = new Connection(DEVNET_RPC, "confirmed");

  console.log("Querying LZ Endpoint program:", LZ_ENDPOINT_PROGRAM.toBase58());
  console.log("OApp Store:", OAPP_STORE.toBase58());
  console.log("Destination EID:", DST_EID);

  // TODO: Use @layerzerolabs/lz-solana-sdk-v2 to derive the ULN config PDA
  // and fetch the DVN/executor configuration for this (store, dstEid) pair.
  //
  // Pseudocode:
  //   const ulnConfigPda = UlnProgram.deriveConfigPDA(OAPP_STORE, DST_EID);
  //   const config = await UlnProgram.getConfig(connection, ulnConfigPda);
  //   assert(config.requiredDvns.length >= 1, "At least one DVN required");
  //   assert(config.optionalDvns.length >= 0, "Optional DVNs ok");

  console.log(
    "[STUB] In a full implementation, this would read the ULN config and assert DVN presence."
  );
}

main().catch(console.error);
