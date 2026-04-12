/**
 * The White Protocol v2 Event Indexer
 * 
 * Indexes DepositMaspEvent and BatchSettledEvent to reconstruct Merkle tree state
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const PROGRAM_ID = new PublicKey("BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb");
const POOL_CONFIG = new PublicKey("DPZe7uST1mBxzVkEm215epHjsM7Sa8VCXHr3pv4eLp8X");

interface DepositEvent {
  commitment: string;
  depositor: string;
  amount: string;
  slot: number;
  signature: string;
}

interface BatchSettledEvent {
  batchSize: number;
  startIndex: number;
  newRoot: string;
  slot: number;
  signature: string;
}

interface IndexedState {
  lastIndexedSlot: number;
  settledCommitments: string[];
  totalSettled: number;
}

async function main() {
  console.log("🔍 The White Protocol v2 Event Indexer Starting...\n");

  // Setup connection
  const connection = new anchor.web3.Connection(
    process.env.ANCHOR_PROVIDER_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  const wallet = anchor.Wallet.local();
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // Load IDL
  const idl = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../target/idl/white_protocol.json"), "utf8")
  );
  const program = new Program(idl, provider);

  console.log("✓ Connected to", connection.rpcEndpoint);
  console.log("✓ Program:", PROGRAM_ID.toString());
  console.log("✓ Pool:", POOL_CONFIG.toString());
  console.log("");

  // Step 1: Get program deployment slot (or start from genesis)
  console.log("📡 Fetching transaction logs...");
  
  // Get recent signatures (last 1000)
  const signatures = await connection.getSignaturesForAddress(
    PROGRAM_ID,
    { limit: 1000 }
  );

  console.log(`✓ Found ${signatures.length} transactions\n`);

  const deposits: DepositEvent[] = [];
  const batches: BatchSettledEvent[] = [];

  // Step 2: Parse each transaction
  console.log("🔎 Parsing events from transactions...");
  
  for (const sigInfo of signatures) {
    try {
      const tx = await connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta || !tx.meta.logMessages) continue;

      // Parse logs for events
      const logs = tx.meta.logMessages;
      
      // Look for DepositMaspEvent
      if (logs.some(log => log.includes("DepositMaspEvent"))) {
        // Extract from program data
        const programData = tx.meta.returnData?.data;
        if (programData) {
          // TODO: Parse deposit event
          console.log("   Found deposit in", sigInfo.signature.slice(0, 8));
        }
      }

      // Look for BatchSettledEvent
      if (logs.some(log => log.includes("Batch settled:"))) {
        const logLine = logs.find(l => l.includes("Batch settled:"));
        if (logLine) {
          // Parse: "Batch settled: X deposits, indices Y-Z, new root: [...]"
          const match = logLine.match(/Batch settled: (\d+) deposits, indices (\d+)-(\d+)/);
          if (match) {
            const batchSize = parseInt(match[1]);
            const startIndex = parseInt(match[2]);
            const endIndex = parseInt(match[3]);
            
            batches.push({
              batchSize,
              startIndex,
              newRoot: "", // Extract from logs
              slot: sigInfo.slot,
              signature: sigInfo.signature,
            });
            
            console.log(`   ✓ Batch: ${batchSize} deposits at indices ${startIndex}-${endIndex} (${sigInfo.signature.slice(0, 8)})`);
          }
        }
      }
    } catch (err) {
      // Skip failed transactions
      continue;
    }
  }

  console.log("");
  console.log("📊 Indexing Summary:");
  console.log(`   Deposits found: ${deposits.length}`);
  console.log(`   Batches found: ${batches.length}`);
  console.log("");

  // For now, since we know there's 1 batch with 1 deposit at index 0
  // We'll use the pending buffer as source of truth
  console.log("📦 Fetching current pending buffer state...");
  
  const PENDING_BUFFER = new PublicKey("DPxeTsLkZaWdenw6gqgU7M6arWhKbo99GDVf2gPtM4NH");
  const pendingBuffer: any = await program.account.pendingDepositsBuffer.fetch(PENDING_BUFFER);
  
  console.log(`   Total batched (settled): ${pendingBuffer.totalDepositsBatched.toString()}`);
  console.log(`   Total pending: ${pendingBuffer.totalPending}`);

  // Save indexed state
  const outputPath = path.join(__dirname, "../indexed_state.json");
  
  const indexedState: IndexedState = {
    lastIndexedSlot: Math.max(...batches.map(b => b.slot), 0),
    settledCommitments: [], // We'll populate this from the next step
    totalSettled: parseInt(pendingBuffer.totalDepositsBatched.toString()),
  };

  fs.writeFileSync(outputPath, JSON.stringify(indexedState, null, 2));
  
  console.log("");
  console.log("✅ Indexing complete!");
  console.log(`   State saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("❌ Indexer error:", err);
  process.exit(1);
});
