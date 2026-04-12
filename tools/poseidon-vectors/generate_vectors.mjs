#!/usr/bin/env node
/**
 * Generate Poseidon test vectors from circomlibjs
 * 
 * Usage: node generate_vectors.mjs
 * Output: vectors.json
 * 
 * This script generates deterministic test vectors for verifying
 * the Rust Poseidon implementation matches circomlibjs.
 */

import { buildPoseidon } from 'circomlibjs';
import { writeFileSync } from 'fs';
import { createHash } from 'crypto';

// Deterministic PRNG using seed (so vectors are reproducible)
function seededRandom(seed) {
  let hash = createHash('sha256').update(seed).digest();
  let offset = 0;
  
  return function nextBytes(n) {
    const result = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      if (offset >= hash.length) {
        hash = createHash('sha256').update(hash).digest();
        offset = 0;
      }
      result[i] = hash[offset++];
    }
    return result;
  };
}

function bigIntToBe32Hex(x) {
  let hex = x.toString(16);
  if (hex.length > 64) {
    throw new Error("Value does not fit in 32 bytes");
  }
  return "0x" + hex.padStart(64, "0");
}

function u64ToBe32Hex(n) {
  const buf = Buffer.alloc(32);
  const x = BigInt(n);
  for (let i = 0; i < 8; i++) {
    buf[31 - i] = Number((x >> BigInt(8 * i)) & 0xffn);
  }
  return "0x" + buf.toString("hex");
}

async function main() {
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const p = BigInt(F.p.toString());
  
  // Helper to convert field element to BigInt
  function toBigInt(fe) {
    if (typeof F.toObject === "function") return F.toObject(fe);
    if (typeof F.toString === "function") return BigInt(F.toString(fe));
    return BigInt(fe.toString());
  }
  
  // Hash and format output
  function hashToHex(inputs) {
    const inputsBig = inputs.map(h => BigInt(h));
    const out = poseidon(inputsBig);
    return bigIntToBe32Hex(toBigInt(out));
  }
  
  // Generate random field element < p using seeded PRNG
  function randFr(prng) {
    const bytes = prng(32);
    const val = BigInt("0x" + bytes.toString("hex")) % p;
    return bigIntToBe32Hex(val);
  }
  
  // Initialize deterministic PRNG
  const prng = seededRandom("white-protocol-poseidon-vectors-v1");
  
  // ============ Poseidon2 vectors (2 inputs) ============
  const vectors2 = [
    // Simple deterministic cases
    { in: [u64ToBe32Hex(0), u64ToBe32Hex(0)] },
    { in: [u64ToBe32Hex(1), u64ToBe32Hex(2)] },
    { in: [u64ToBe32Hex(123), u64ToBe32Hex(456)] },
    { in: [u64ToBe32Hex(0xDEADBEEF), u64ToBe32Hex(0xCAFEBABE)] },
  ];
  
  // Random vectors for thorough coverage
  for (let i = 0; i < 20; i++) {
    vectors2.push({ in: [randFr(prng), randFr(prng)] });
  }
  
  // ============ Poseidon3 vectors (3 inputs) ============
  const vectors3 = [
    { in: [u64ToBe32Hex(0), u64ToBe32Hex(0), u64ToBe32Hex(0)] },
    { in: [u64ToBe32Hex(1), u64ToBe32Hex(2), u64ToBe32Hex(3)] },
    { in: [u64ToBe32Hex(11), u64ToBe32Hex(22), u64ToBe32Hex(33)] },
    { in: [u64ToBe32Hex(0xFF), u64ToBe32Hex(0xFFFF), u64ToBe32Hex(0xFFFFFF)] },
  ];
  
  for (let i = 0; i < 20; i++) {
    vectors3.push({ in: [randFr(prng), randFr(prng), randFr(prng)] });
  }
  
  // ============ Poseidon4 vectors (4 inputs) ============
  const vectors4 = [
    { in: [u64ToBe32Hex(0), u64ToBe32Hex(0), u64ToBe32Hex(0), u64ToBe32Hex(0)] },
    { in: [u64ToBe32Hex(1), u64ToBe32Hex(2), u64ToBe32Hex(3), u64ToBe32Hex(4)] },
    { in: [u64ToBe32Hex(9), u64ToBe32Hex(8), u64ToBe32Hex(7), u64ToBe32Hex(6)] },
    { in: [u64ToBe32Hex(1000000000), u64ToBe32Hex(2000000000), u64ToBe32Hex(3000000000), u64ToBe32Hex(4000000000)] },
  ];
  
  for (let i = 0; i < 20; i++) {
    vectors4.push({ in: [randFr(prng), randFr(prng), randFr(prng), randFr(prng)] });
  }
  
  // Compute outputs
  for (const v of vectors2) v.out = hashToHex(v.in);
  for (const v of vectors3) v.out = hashToHex(v.in);
  for (const v of vectors4) v.out = hashToHex(v.in);
  
  const output = {
    meta: {
      generator: "generate_vectors.mjs using circomlibjs.buildPoseidon()",
      field: "BN254 scalar field (Fr)",
      prime_hex: bigIntToBe32Hex(p),
      seed: "white-protocol-poseidon-vectors-v1",
      generated_at: new Date().toISOString(),
      count: {
        poseidon2: vectors2.length,
        poseidon3: vectors3.length,
        poseidon4: vectors4.length,
      },
    },
    poseidon2: vectors2,
    poseidon3: vectors3,
    poseidon4: vectors4,
  };
  
  writeFileSync("vectors.json", JSON.stringify(output, null, 2));
  console.log(`✓ Generated vectors.json with ${vectors2.length + vectors3.length + vectors4.length} test vectors`);
  console.log(`  - poseidon2: ${vectors2.length} vectors`);
  console.log(`  - poseidon3: ${vectors3.length} vectors`);
  console.log(`  - poseidon4: ${vectors4.length} vectors`);
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
