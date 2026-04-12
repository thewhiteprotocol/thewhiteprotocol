import { buildPoseidon } from 'circomlibjs';

async function main() {
  const poseidon = await buildPoseidon();
  
  const hash2 = (a: bigint, b: bigint): bigint => {
    const result = poseidon([a, b]);
    return BigInt(poseidon.F.toString(result));
  };
  
  // Compute zero values like the on-chain code does
  const zeros: bigint[] = [BigInt(0)];
  for (let i = 1; i <= 20; i++) {
    zeros.push(hash2(zeros[i-1], zeros[i-1]));
  }
  
  console.log("Zero values:");
  for (let i = 0; i <= 20; i++) {
    const hex = zeros[i].toString(16).padStart(64, '0');
    console.log(`  Level ${i}: ${hex.substring(0, 20)}...`);
  }
  
  console.log("\nExpected empty tree root (level 20):");
  console.log(" ", zeros[20].toString(16).padStart(64, '0'));
  
  // Compare with on-chain root
  const onChainRoot = "2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e";
  console.log("\nOn-chain root:");
  console.log(" ", onChainRoot);
  
  console.log("\nMatch:", zeros[20].toString(16).padStart(64, '0') === onChainRoot ? "YES" : "NO");
}

main().catch(console.error);
