// scripts/rebuild-commitments-from-events.ts
// Production-grade: strict, no fake leaf filling, fails loudly if incomplete
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

type Args = {
  programId: PublicKey;
  merkleTree: PublicKey;
  outPath: string;
  pageLimit: number;
  maxPages: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const programStr = get("--program") ?? "BmtMrkgvVML9Gk7Bt6JRqweHAwW69oFTohaBRaLbgqpb";
  const merkleStr = get("--merkle");
  if (!merkleStr) {
    throw new Error("Missing --merkle <MERKLE_TREE_PUBKEY>. This must match the pool's merkle tree account.");
  }

  const outPath = get("--out") ?? "sequencer-state.json";
  const pageLimit = Number(get("--pageLimit") ?? "1000");
  const maxPages = Number(get("--maxPages") ?? "200");

  if (!Number.isFinite(pageLimit) || pageLimit <= 0 || pageLimit > 1000) {
    throw new Error("--pageLimit must be 1..1000");
  }
  if (!Number.isFinite(maxPages) || maxPages <= 0) {
    throw new Error("--maxPages must be > 0");
  }

  return { programId: new PublicKey(programStr), merkleTree: new PublicKey(merkleStr), outPath, pageLimit, maxPages };
}

function toHex32(bytes: number[] | Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function parseLeafIndex(maybe: any): number | null {
  const n = Number(maybe);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

async function main() {
  const { programId, merkleTree, outPath, pageLimit, maxPages } = parseArgs();

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  if (!fs.existsSync("target/idl/white_protocol.json")) {
    throw new Error("Missing target/idl/white_protocol.json. Run: anchor build");
  }

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const coder = new anchor.BorshCoder(idl);
  const parser = new anchor.EventParser(programId, coder);
  const program = new anchor.Program(idl, provider);

  // Fetch on-chain state
  const merkleAcc: any = await (program.account as any).merkleTreeV2.fetch(merkleTree);
  const targetLeaves: number = Number(merkleAcc.nextLeafIndex);

  console.log("Program:", programId.toBase58());
  console.log("Merkle :", merkleTree.toBase58());
  console.log("RPC    :", provider.connection.rpcEndpoint);
  console.log("Need leaves (nextLeafIndex):", targetLeaves);

  if (targetLeaves === 0) {
    fs.writeFileSync(outPath, JSON.stringify({
      programId: programId.toBase58(),
      merkleTree: merkleTree.toBase58(),
      nextLeafIndex: 0,
      commitments: [],
      rebuiltAt: new Date().toISOString(),
    }, null, 2));
    console.log("No leaves inserted; wrote empty state to", outPath);
    return;
  }

  // Collect leafIndex -> commitment
  const byIndex = new Map<number, string>();

  let before: string | undefined = undefined;
  let pages = 0;
  let scanned = 0;

  console.log("Rebuilding from on-chain events (strict mode)...");
  console.log("We will stop only when all leaves [0.." + (targetLeaves - 1) + "] are recovered.");

  while (byIndex.size < targetLeaves && pages < maxPages) {
    pages += 1;

    const sigs = await provider.connection.getSignaturesForAddress(programId, { limit: pageLimit, before }, "confirmed");
    if (sigs.length === 0) break;

    before = sigs[sigs.length - 1].signature;
    scanned += sigs.length;

    console.log(`Page ${pages}: scanned ${scanned} sigs, recovered ${byIndex.size}/${targetLeaves} leaves`);

    for (const s of sigs) {
      if (byIndex.size >= targetLeaves) break;

      try {
        const tx = await provider.connection.getTransaction(s.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx?.meta?.logMessages) continue;

        parser.parseLogs(tx.meta.logMessages, (ev: any) => {
          // CommitmentInsertedEvent from settle_deposits_batch
          if (ev.name === "CommitmentInsertedEvent") {
            const idx = parseLeafIndex(ev.data.leafIndex ?? ev.data.leaf_index);
            if (idx !== null) {
              const commitmentHex = toHex32(ev.data.commitment);
              if (!byIndex.has(idx)) {
                byIndex.set(idx, commitmentHex);
                console.log(`  Leaf ${idx}: ${commitmentHex.slice(0, 16)}...`);
              }
            }
          }
          // DepositMaspEvent (older path, may have leaf_index)
          if (ev.name === "DepositMaspEvent") {
            const idx = parseLeafIndex(ev.data.leafIndex ?? ev.data.leaf_index);
            if (idx !== null) {
              const commitmentHex = toHex32(ev.data.commitment);
              if (!byIndex.has(idx)) {
                byIndex.set(idx, commitmentHex);
                console.log(`  Leaf ${idx} (deposit): ${commitmentHex.slice(0, 16)}...`);
              }
            }
          }
        });
      } catch (e) {
        // Skip failed tx fetches
      }
    }
  }

  console.log(`\nRecovered ${byIndex.size}/${targetLeaves} leaves`);

  // STRICT: fail if any leaf is missing
  const missing: number[] = [];
  for (let i = 0; i < targetLeaves; i++) {
    if (!byIndex.has(i)) missing.push(i);
  }

  if (missing.length > 0) {
    console.error(`\n❌ FATAL: Missing leaves: [${missing.join(", ")}]`);
    console.error("Cannot proceed with incomplete tree state.");
    console.error("Check if historical transactions are accessible via this RPC.");
    process.exit(1);
  }

  // Build ordered commitments
  const commitments: string[] = [];
  for (let i = 0; i < targetLeaves; i++) {
    commitments.push(byIndex.get(i)!);
  }

  const state = {
    programId: programId.toBase58(),
    merkleTree: merkleTree.toBase58(),
    nextLeafIndex: targetLeaves,
    commitments,
    rebuiltAt: new Date().toISOString(),
  };

  fs.writeFileSync(outPath, JSON.stringify(state, null, 2));
  console.log(`\n✓ Wrote ${outPath} with ${commitments.length} commitments`);
  console.log(`  Leaf 0: ${commitments[0].slice(0, 16)}...`);
  console.log(`  Leaf ${targetLeaves - 1}: ${commitments[targetLeaves - 1].slice(0, 16)}...`);
}

main().catch((e) => {
  console.error("Fatal:", e.message || e);
  process.exit(1);
});
