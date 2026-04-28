/**
 * Verify settlement proof using @noble/curves BN254 pairing.
 * This simulates the EXACT on-chain verifier logic.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { bn254 } from '@noble/curves/bn254';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function bigintToBytes32BE(bn: bigint): Uint8Array {
  const hex = bn.toString(16).padStart(64, '0');
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// BN254 Fr modulus (scalar field)
const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Load proof and VK
const proofJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../test-proofs/batch_proof.json'), 'utf8'));
const vkJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../circuits/merkle_batch_update/build/verification_key.json'), 'utf8'));

console.log("=== BN254 Pairing Verification (Noble Curves) ===\n");

// Parse public inputs
const publicSignals = proofJson.publicSignals.map((s: string) => BigInt(s));
console.log("Public inputs:");
publicSignals.forEach((s: bigint, i: number) => console.log(`  [${i}] ${s}`));

// Validate public inputs are < Fr
for (let i = 0; i < publicSignals.length; i++) {
  if (publicSignals[i] >= FR_MODULUS) {
    console.log(`\n❌ Public input ${i} >= Fr modulus!`);
    process.exit(1);
  }
}
console.log("\n✅ All public inputs are canonical Fr elements");

// Format proof bytes exactly as Solana verifier expects
const proofBytes = Buffer.alloc(256);
let offset = 0;
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_a[0])), offset); offset += 32;
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_a[1])), offset); offset += 32;
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[0][1])), offset); offset += 32; // x_imag
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[0][0])), offset); offset += 32; // x_real
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[1][1])), offset); offset += 32; // y_imag
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_b[1][0])), offset); offset += 32; // y_real
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_c[0])), offset); offset += 32;
proofBytes.set(bigintToBytes32BE(BigInt(proofJson.proof.pi_c[1])), offset); offset += 32;

// Parse G1 point from 64 bytes (x || y)
function parseG1(bytes: Uint8Array) {
  const x = BigInt('0x' + bytesToHex(bytes.slice(0, 32)));
  const y = BigInt('0x' + bytesToHex(bytes.slice(32, 64)));
  return bn254.G1.ProjectivePoint.fromAffine({ x, y });
}

// Parse G2 point from 128 bytes (x_imag || x_real || y_imag || y_real)
function parseG2(bytes: Uint8Array) {
  const x_c1 = BigInt('0x' + bytesToHex(bytes.slice(0, 32)));
  const x_c0 = BigInt('0x' + bytesToHex(bytes.slice(32, 64)));
  const y_c1 = BigInt('0x' + bytesToHex(bytes.slice(64, 96)));
  const y_c0 = BigInt('0x' + bytesToHex(bytes.slice(96, 128)));
  return bn254.G2.ProjectivePoint.fromAffine({ x: { c0: x_c0, c1: x_c1 }, y: { c0: y_c0, c1: y_c1 } });
}

const proofA = parseG1(proofBytes.slice(0, 64));
const proofB = parseG2(proofBytes.slice(64, 192));
const proofC = parseG1(proofBytes.slice(192, 256));

console.log("\nProof points parsed");

// Parse VK
const vkAlpha = parseG1(Uint8Array.from([
  ...bigintToBytes32BE(BigInt(vkJson.vk_alpha_1[0])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_alpha_1[1]))
]));

const vkBeta = parseG2(Uint8Array.from([
  ...bigintToBytes32BE(BigInt(vkJson.vk_beta_2[0][1])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_beta_2[0][0])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_beta_2[1][1])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_beta_2[1][0]))
]));

const vkGamma = parseG2(Uint8Array.from([
  ...bigintToBytes32BE(BigInt(vkJson.vk_gamma_2[0][1])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_gamma_2[0][0])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_gamma_2[1][1])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_gamma_2[1][0]))
]));

const vkDelta = parseG2(Uint8Array.from([
  ...bigintToBytes32BE(BigInt(vkJson.vk_delta_2[0][1])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_delta_2[0][0])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_delta_2[1][1])),
  ...bigintToBytes32BE(BigInt(vkJson.vk_delta_2[1][0]))
]));

console.log("VK points parsed");

// Parse IC points
const icPoints = vkJson.IC.map((ic: string[]) => parseG1(Uint8Array.from([
  ...bigintToBytes32BE(BigInt(ic[0])),
  ...bigintToBytes32BE(BigInt(ic[1]))
])));

console.log("IC points parsed:", icPoints.length);

// Compute vk_x = IC[0] + sum(input[i] * IC[i+1])
let vkX = icPoints[0];
for (let i = 0; i < publicSignals.length; i++) {
  if (publicSignals[i] === 0n) continue;
  const scalar = publicSignals[i];
  const icPoint = icPoints[i + 1];
  
  // scalar * IC[i+1]
  const product = icPoint.multiply(scalar);
  
  // vk_x += product
  if (vkX.equals(bn254.G1.ProjectivePoint.ZERO)) {
    vkX = product;
  } else {
    vkX = vkX.add(product);
  }
}

console.log("vk_x computed");

// Negate A: -A = (x, -y)
const negA = bn254.G1.ProjectivePoint.fromAffine({ x: proofA.toAffine().x, y: bn254.G1.CURVE.p - proofA.toAffine().y });

// Build pairing elements for e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) = 1
const pairingResult = bn254.pairingBatch([
  { g1: negA, g2: proofB },
  { g1: vkAlpha, g2: vkBeta },
  { g1: vkX, g2: vkGamma },
  { g1: proofC, g2: vkDelta },
]);

console.log("\nPairing result is identity:", pairingResult);

if (pairingResult) {
  console.log("\n✅ PAIRING CHECK PASSES - Proof is mathematically valid!");
} else {
  console.log("\n❌ PAIRING CHECK FAILS - Proof is invalid!");
}
