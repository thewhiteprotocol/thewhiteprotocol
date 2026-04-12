import { buildPoseidon } from 'circomlibjs';

async function main() {
  const poseidon = await buildPoseidon();
  
  const hash2 = (a: bigint, b: bigint): bigint => {
    const result = poseidon([a, b]);
    return BigInt(poseidon.F.toString(result));
  };
  
  // Compute zero values
  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= 20; i++) {
    zeros.push(hash2(zeros[i-1], zeros[i-1]));
  }
  
  console.log("Zero tree root (level 20):", zeros[20].toString());
  
  // For index 0, path elements should be the zero values at each level
  // Compute root with leaf=0 and all pathElements=0
  let root = BigInt(0);
  for (let i = 0; i < 20; i++) {
    root = hash2(root, BigInt(0));
  }
  
  console.log("\nComputed root with all-zero path:", root.toString());
  console.log("Match zero tree root:", root === zeros[20]);
  
  // The path elements for an empty slot at index 0 are the zero values
  console.log("\nPath elements for index 0 (first 5):");
  for (let i = 0; i < 5; i++) {
    console.log(`  Level ${i}: ${zeros[i].toString().substring(0, 30)}...`);
  }
}

main().catch(console.error);
