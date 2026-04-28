import * as fs from "fs";

const batch = JSON.parse(fs.readFileSync("test-proofs/batch_proof.json", "utf8"));
const settlement = JSON.parse(fs.readFileSync("test-proofs/settlement_proof.json", "utf8"));

console.log("=== batch_proof.json ===");
console.log("Public signals:");
batch.publicSignals.forEach((s: string, i: number) => {
    console.log(`  [${i}] ${BigInt(s).toString(16).padStart(64, "0")}`);
});

console.log("\n=== settlement_proof.json ===");
console.log("Public signals:");
settlement.publicSignals.forEach((s: string, i: number) => {
    console.log(`  [${i}] ${BigInt(s).toString(16).padStart(64, "0")}`);
});

// Compare proofs - handle different structures
const batchProof = batch.proof;
const settlementProof = settlement.proof;

console.log("\n=== Proof structure ===");
console.log("batch pi_a:", batchProof.pi_a);
console.log("settlement pi_a:", settlementProof.pi_a);
console.log("batch pi_b:", JSON.stringify(batchProof.pi_b).slice(0, 100));
console.log("settlement pi_b:", JSON.stringify(settlementProof.pi_b).slice(0, 100));
console.log("batch pi_c:", batchProof.pi_c);
console.log("settlement pi_c:", settlementProof.pi_c);
