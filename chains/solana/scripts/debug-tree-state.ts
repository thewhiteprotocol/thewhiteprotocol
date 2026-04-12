import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";

// @ts-ignore
const circomlibjs = require("circomlibjs");

let poseidon: any;

async function initPoseidon() {
  poseidon = await circomlibjs.buildPoseidon();
}

function poseidonHash(inputs: bigint[]): bigint {
  const hash = poseidon(inputs.map((x) => poseidon.F.e(x)));
  return BigInt(poseidon.F.toString(hash));
}

// Compute tree root from single leaf at index 0
function computeRootFromLeaf(leaf: bigint, depth: number): bigint {
  // Compute zero hashes
  const zeroHashes: bigint[] = [0n];
  for (let i = 1; i <= depth; i++) {
    zeroHashes.push(poseidonHash([zeroHashes[i-1], zeroHashes[i-1]]));
  }
  
  // Start with leaf at index 0
  let current = leaf;
  for (let i = 0; i < depth; i++) {
    // Index 0 means always go left, sibling is zero hash
    current = poseidonHash([current, zeroHashes[i]]);
  }
  return current;
}

function bytes32ToBigint(bytes: number[] | Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < 32; i++) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

function bytes32ToBigintLE(bytes: number[] | Uint8Array): bigint {
  let result = 0n;
  for (let i = 31; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

async function main() {
  await initPoseidon();
  console.log("✓ Poseidon initialized\n");

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync("target/idl/white_protocol.json", "utf8"));
  const program = new anchor.Program(idl, provider);

  const MERKLE_TREE = new PublicKey("E1vS4WWQZ6j3jrbtr9gE8yotTAVqq1HNqEWN7ybjC8s3");
  
  // Fetch on-chain merkle tree
  const merkleAcc: any = await (program.account as any).merkleTreeV2.fetch(MERKLE_TREE);
  
  console.log("=== ON-CHAIN STATE ===");
  console.log("Next leaf index:", merkleAcc.nextLeafIndex);
  console.log("Current root (raw bytes):", Array.from(merkleAcc.currentRoot).slice(0, 8), "...");
  
  const onChainRootBE = bytes32ToBigint(merkleAcc.currentRoot);
  const onChainRootLE = bytes32ToBigintLE(merkleAcc.currentRoot);
  console.log("Current root (BE hex):", onChainRootBE.toString(16).padStart(64, "0").slice(0, 16), "...");
  console.log("Current root (LE hex):", onChainRootLE.toString(16).padStart(64, "0").slice(0, 16), "...");
  
  // Our extracted commitment
  const commitmentHex = "deacc107524b5857d599d9bbd5b6844f25926bbb86f1bd689a05785911a2c070";
  const commitmentBE = BigInt("0x" + commitmentHex);
  
  // Also try reversed (LE interpretation)
  const commitmentBytes = Buffer.from(commitmentHex, "hex");
  const commitmentLE = bytes32ToBigintLE(commitmentBytes);
  
  console.log("\n=== COMMITMENT OPTIONS ===");
  console.log("Commitment hex:", commitmentHex.slice(0, 16), "...");
  console.log("As BE bigint:", commitmentBE.toString(16).padStart(64, "0").slice(0, 16), "...");
  console.log("As LE bigint:", commitmentLE.toString(16).padStart(64, "0").slice(0, 16), "...");
  
  // Compute roots with both interpretations
  console.log("\n=== COMPUTED ROOTS (depth=20) ===");
  const rootFromBE = computeRootFromLeaf(commitmentBE, 20);
  const rootFromLE = computeRootFromLeaf(commitmentLE, 20);
  
  console.log("Root from BE commitment:", rootFromBE.toString(16).padStart(64, "0").slice(0, 16), "...");
  console.log("Root from LE commitment:", rootFromLE.toString(16).padStart(64, "0").slice(0, 16), "...");
  
  // Check which matches
  console.log("\n=== MATCH CHECK ===");
  if (rootFromBE === onChainRootBE) {
    console.log("✓ BE commitment + BE root MATCHES!");
  } else if (rootFromBE === onChainRootLE) {
    console.log("✓ BE commitment + LE root MATCHES!");
  } else if (rootFromLE === onChainRootBE) {
    console.log("✓ LE commitment + BE root MATCHES!");
  } else if (rootFromLE === onChainRootLE) {
    console.log("✓ LE commitment + LE root MATCHES!");
  } else {
    console.log("✗ No direct match found");
    console.log("  Expected (BE):", onChainRootBE.toString(16).slice(0, 32));
    console.log("  Expected (LE):", onChainRootLE.toString(16).slice(0, 32));
    console.log("  Got from BE:", rootFromBE.toString(16).slice(0, 32));
    console.log("  Got from LE:", rootFromLE.toString(16).slice(0, 32));
  }
  
  // Also print the empty tree root for reference
  const emptyTreeRoot = computeRootFromLeaf(0n, 20);
  console.log("\n=== REFERENCE ===");
  console.log("Empty tree root:", emptyTreeRoot.toString(16).slice(0, 16), "...");
}

main().catch(console.error);
