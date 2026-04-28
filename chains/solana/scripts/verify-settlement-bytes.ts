/**
 * Verify settlement proof after round-tripping through Solana byte format.
 * This tests whether the byte conversion introduces any corruption.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function bigintToBytes32BE(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function bytes32ToBigint(bytes: Uint8Array): bigint {
  return BigInt('0x' + Buffer.from(bytes).toString('hex'));
}

// Load proof and VK
const proofJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-proofs/batch_proof.json'), 'utf8'));
const vkJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../circuits/merkle_batch_update/build/verification_key.json'), 'utf8'));

console.log("=== Round-trip Verification Test ===\n");

// Format proof as Solana expects (256 bytes)
const proofBytes = Buffer.alloc(256);
let offset = 0;

// pi_a: x, y
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_a[0])), offset); offset += 32;
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_a[1])), offset); offset += 32;

// pi_b: x_imag, x_real, y_imag, y_real
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[0][1])), offset); offset += 32; // x_imag
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[0][0])), offset); offset += 32; // x_real
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[1][1])), offset); offset += 32; // y_imag
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[1][0])), offset); offset += 32; // y_real

// pi_c: x, y
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_c[0])), offset); offset += 32;
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_c[1])), offset); offset += 32;

console.log("Proof bytes length:", proofBytes.length);
console.log("Proof header:", proofBytes.slice(0, 8).toString('hex'));

// Now convert back to snarkjs format
const recoveredProof = {
  pi_a: [
    bytes32ToBigint(proofBytes.slice(0, 32)).toString(),
    bytes32ToBigint(proofBytes.slice(32, 64)).toString(),
    "1"
  ],
  pi_b: [
    [
      bytes32ToBigint(proofBytes.slice(96, 128)).toString(),  // x_real
      bytes32ToBigint(proofBytes.slice(64, 96)).toString(),   // x_imag
    ],
    [
      bytes32ToBigint(proofBytes.slice(160, 192)).toString(), // y_real
      bytes32ToBigint(proofBytes.slice(128, 160)).toString(), // y_imag
    ],
    ["1", "0"]
  ],
  pi_c: [
    bytes32ToBigint(proofBytes.slice(192, 224)).toString(),
    bytes32ToBigint(proofBytes.slice(224, 256)).toString(),
    "1"
  ],
  protocol: "groth16",
  curve: "bn128"
};

console.log("\nOriginal proof pi_b[0][0]:", proofJson.proof.pi_b[0][0]);
console.log("Recovered proof pi_b[0][0]:", recoveredProof.pi_b[0][0]);
console.log("Match:", proofJson.proof.pi_b[0][0] === recoveredProof.pi_b[0][0]);

async function main() {
// Verify with snarkjs using recovered proof
const snarkjs = await import('snarkjs');
const isValid = await snarkjs.groth16.verify(vkJson, proofJson.publicSignals, recoveredProof);
console.log("\nSnarkjs verify (recovered proof):", isValid ? "✅ PASS" : "❌ FAIL");

// Also verify with original proof for comparison
const isValidOrig = await snarkjs.groth16.verify(vkJson, proofJson.publicSignals, proofJson.proof);
console.log("Snarkjs verify (original proof):", isValidOrig ? "✅ PASS" : "❌ FAIL");

// Check if the proof bytes match what the test-settle-deposits-batch.ts script produces
const testScriptProof = fs.readFileSync(path.join(__dirname, '../test-proofs/settlement_proof.json'), 'utf8');
const settlementProof = JSON.parse(testScriptProof);
const settlementProofBytes = Buffer.from(settlementProof.proof);
console.log("\nSettlement proof bytes length:", settlementProofBytes.length);
console.log("Batch proof bytes length:", proofBytes.length);

if (settlementProofBytes.length === proofBytes.length) {
  let diff = 0;
  for (let i = 0; i < proofBytes.length; i++) {
    if (settlementProofBytes[i] !== proofBytes[i]) diff++;
  }
  console.log("Bytes differing from settlement_proof.json:", diff);
}
}

main().catch(console.error);
