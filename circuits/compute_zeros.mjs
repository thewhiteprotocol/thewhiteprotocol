import { buildPoseidon } from "circomlibjs";

const poseidon = await buildPoseidon();
const F = poseidon.F;

// Compute zero values for Merkle tree (up to depth 24)
const MAX_DEPTH = 24;
const zeros = [];

// Level 0: zero leaf
zeros.push(0n);

// Each level: hash(prev, prev)
for (let i = 1; i <= MAX_DEPTH; i++) {
    const prev = zeros[i - 1];
    const hash = poseidon([prev, prev]);
    zeros.push(F.toObject(hash));
}

console.log("// Precomputed Poseidon zero values for Merkle tree");
console.log("// zeros[i] = hash(zeros[i-1], zeros[i-1])");
console.log("// Generated with circomlibjs - DO NOT EDIT\n");

console.log("pub const PRECOMPUTED_ZEROS: [[u8; 32]; 25] = [");
for (let i = 0; i <= MAX_DEPTH; i++) {
    const hex = zeros[i].toString(16).padStart(64, '0');
    const bytes = hex.match(/.{2}/g).map(b => `0x${b}`).join(', ');
    console.log(`    [${bytes}], // level ${i}`);
}
console.log("];");
