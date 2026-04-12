import { buildPoseidon } from 'circomlibjs';

async function main() {
    const poseidon = await buildPoseidon();
    
    // Hash two zeros
    const result = poseidon([0, 0]);
    console.log("Poseidon(0, 0):");
    console.log("  F.toString:", poseidon.F.toString(result));
    console.log("  F.toObject:", poseidon.F.toObject(result));
    console.log("  Raw:", result);
    
    // Hash 1 and 2
    const result2 = poseidon([1, 2]);
    console.log("\nPoseidon(1, 2):");
    console.log("  F.toString:", poseidon.F.toString(result2));
    console.log("  F.toObject:", poseidon.F.toObject(result2));
    
    // Build tree of zeros
    let h = BigInt(0);
    console.log("\nTree of zeros:");
    for (let i = 0; i <= 20; i++) {
        console.log(`  Level ${i}: ${h.toString()}`);
        const r = poseidon([h, h]);
        h = BigInt(poseidon.F.toString(r));
    }
}

main().catch(console.error);
