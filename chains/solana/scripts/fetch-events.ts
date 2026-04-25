/**
 * Fetch all Anchor events for the program using EventParser
 */

import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const conn = new Connection(provider.connection.rpcEndpoint, "confirmed");

  const idl = JSON.parse(require("fs").readFileSync("./target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);
  const eventParser = new anchor.EventParser(PROGRAM_ID, new anchor.BorshCoder(idl));

  console.log("Fetching signatures...");
  const allSigs: string[] = [];
  let beforeSig: string | undefined;

  while (true) {
    const sigs = await conn.getSignaturesForAddress(PROGRAM_ID, {
      limit: 100,
      before: beforeSig,
    });
    if (sigs.length === 0) break;
    for (const s of sigs) allSigs.push(s.signature);
    beforeSig = sigs[sigs.length - 1].signature;
    if (sigs.length < 100) break;
  }

  console.log(`Total signatures: ${allSigs.length}`);

  const deposits: { commitment: string; timestamp: number; signature: string }[] = [];
  const inserted: { commitment: string; leafIndex: number; signature: string }[] = [];

  for (let i = 0; i < allSigs.length; i++) {
    if (i % 10 === 0) console.log(`Processing ${i}/${allSigs.length}...`);
    await new Promise((r) => setTimeout(r, 300));

    try {
      const tx = await conn.getTransaction(allSigs[i], {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx || !tx.meta || !tx.meta.logMessages) continue;

      for (const event of eventParser.parseLogs(tx.meta.logMessages)) {
        if (event.name === "DepositQueuedEvent") {
          const data = event.data as any;
          deposits.push({
            commitment: Buffer.from(data.commitment).toString("hex"),
            timestamp: data.timestamp,
            signature: allSigs[i],
          });
        } else if (event.name === "CommitmentInsertedEvent") {
          const data = event.data as any;
          inserted.push({
            commitment: Buffer.from(data.commitment).toString("hex"),
            leafIndex: data.leafIndex,
            signature: allSigs[i],
          });
        }
      }
    } catch (e) {
      // ignore
    }
  }

  console.log(`\nDepositQueuedEvent count: ${deposits.length}`);
  console.log(`CommitmentInsertedEvent count: ${inserted.length}`);

  deposits.forEach((d, i) => {
    console.log(`  deposit[${i}] ${d.commitment.slice(0, 16)}... ts=${d.timestamp}`);
  });

  inserted.forEach((e, i) => {
    console.log(`  inserted[${i}] leaf=${e.leafIndex} ${e.commitment.slice(0, 16)}...`);
  });

  require("fs").writeFileSync(
    "./events_dump.json",
    JSON.stringify({ deposits, inserted }, null, 2)
  );
  console.log("\nSaved to events_dump.json");
}

main().catch(console.error);
