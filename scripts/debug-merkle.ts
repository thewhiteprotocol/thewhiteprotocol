import { buildPoseidon } from 'circomlibjs';

async function main() {
    const poseidon = await buildPoseidon();
    
    const hash2 = (a: bigint, b: bigint): bigint => {
        const result = poseidon([a, b]);
        return BigInt(poseidon.F.toString(result));
    };
    
    const depth = 20;
    const startIndex = 0;
    
    // Compute what the circuit computes with:
    // - newLeaf = 0
    // - leafIndex = 0
    // - pathElements = all zeros
    
    console.log("Circuit computation trace:");
    let hashes = BigInt(0); // newLeaf = 0
    console.log(`  Level 0: hashes[0] = ${hashes}`);
    
    const zeroHash = BigInt(0);
    
    for (let i = 0; i < depth; i++) {
        const bit = (startIndex >> i) & 1;
        // muxLeft: s=0 -> c[0]=hashes, s=1 -> c[1]=pathElements[i]
        // muxRight: s=0 -> c[0]=pathElements[i], s=1 -> c[1]=hashes
        
        const left = bit === 0 ? hashes : zeroHash;
        const right = bit === 0 ? zeroHash : hashes;
        
        hashes = hash2(left, right);
        console.log(`  Level ${i+1}: bit=${bit}, left=${left}, right=${right}, hash=${hashes}`);
    }
    
    console.log(`\nFinal root (newRoot): ${hashes}`);
    
    // Compare with my tree computation
    console.log("\nTree computation:");
    let levelHash = BigInt(0);
    for (let i = 0; i <= depth; i++) {
        console.log(`  Level ${i}: ${levelHash}`);
        levelHash = hash2(levelHash, levelHash);
    }
}

main().catch(console.error);
