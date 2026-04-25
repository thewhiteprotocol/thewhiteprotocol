/**
 * Rebuild local Merkle tree from on-chain CommitmentInsertedEvent events
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conn = new Connection(provider.connection.rpcEndpoint, "confirmed");

  const idl = JSON.parse(require("fs").readFileSync("./target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log("Fetching DepositQueuedEvent logs...");

  const allEvents: any[] = [];
  let beforeSig: string | undefined;
  const batchSize = 50;

  while (true) {
    const sigs = await conn.getSignaturesForAddress(PROGRAM_ID, {
      limit: batchSize,
      before: beforeSig,
    });

    if (sigs.length === 0) break;

    for (const sigInfo of sigs) {
      await new Promise((r) => setTimeout(r, 500));
      const tx = await conn.getTransaction(sigInfo.signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta || !tx.meta.logMessages) continue;

      for (const log of tx.meta.logMessages) {
        if (log.includes("DepositQueuedEvent")) {
          const match = log.match(/commitment: \[([^\]]+)\]/);
          if (match) {
            const bytes = match[1].split(", ").map((s: string) => parseInt(s.trim()));
            allEvents.push({ bytes, signature: sigInfo.signature });
          }
        }
      }
    }

    beforeSig = sigs[sigs.length - 1].signature;
    if (sigs.length < batchSize) break;
  }

  // Sort by leaf index
  allEvents.sort((a, b) => a.leafIndex - b.leafIndex);

  console.log(`Found ${allEvents.length} DepositQueuedEvent(s)`);
  for (const e of allEvents) {
    const hex = Buffer.from(e.bytes).toString("hex");
    console.log(`  [${e.leafIndex}] ${hex.slice(0, 16)}...`);
  }

  // Also fetch pending deposits
  const [pendingBufferPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
    PROGRAM_ID
  );

  const pendingBuffer = await (program.account as any).pendingDepositsBuffer.fetch(pendingBufferPda);
  console.log(`\nPending deposits: ${pendingBuffer.deposits.length}`);
  for (let i = 0; i < pendingBuffer.deposits.length; i++) {
    const hex = Buffer.from(pendingBuffer.deposits[i].commitment).toString("hex");
    console.log(`  pending[${i}] ${hex.slice(0, 16)}...`);
  }

  // Save commitments for tree rebuild
  const settledCommitments = allEvents.map((e) => ({
    commitmentHex: Buffer.from(e.bytes).toString("hex"),
  }));

  const pendingCommitments = pendingBuffer.deposits.map((d: any, i: number) => ({
    index: i,
    commitmentHex: Buffer.from(d.commitment).toString("hex"),
  }));

  require("fs").writeFileSync(
    "./tree_commitments.json",
    JSON.stringify({ settled: settledCommitments, pending: pendingCommitments }, null, 2)
  );
  console.log("\nSaved to tree_commitments.json");
}

main().catch(console.error);
