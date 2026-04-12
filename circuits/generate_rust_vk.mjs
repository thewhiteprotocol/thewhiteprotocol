import fs from 'fs';

// Convert decimal string to 32-byte big-endian hex
function toBe32(decStr) {
    let hex = BigInt(decStr).toString(16).padStart(64, '0');
    return hex.match(/.{2}/g).map(b => `0x${b}`).join(', ');
}

// Convert G1 point [x, y, z] to 64 bytes (x || y)
function g1ToBytes(point) {
    return `[\n        ${toBe32(point[0])},\n        ${toBe32(point[1])}\n    ]`;
}

// Convert G2 point [[x0,x1], [y0,y1], [z0,z1]] to 128 bytes
function g2ToBytes(point) {
    // G2 encoding: x1 || x0 || y1 || y0 (reversed order within pairs)
    return `[\n        ${toBe32(point[0][1])},\n        ${toBe32(point[0][0])},\n        ${toBe32(point[1][1])},\n        ${toBe32(point[1][0])}\n    ]`;
}

function generateRustVk(name, vkPath) {
    const vk = JSON.parse(fs.readFileSync(vkPath, 'utf8'));
    const upperName = name.toUpperCase();
    
    let rust = `// Auto-generated verification key for ${name} circuit\n`;
    rust += `// DO NOT EDIT - regenerate with: node generate_rust_vk.mjs\n\n`;
    
    // Alpha (G1)
    rust += `pub const VK_${upperName}_ALPHA_G1: [u8; 64] = ${g1ToBytes(vk.vk_alpha_1)};\n\n`;
    
    // Beta (G2)
    rust += `pub const VK_${upperName}_BETA_G2: [u8; 128] = ${g2ToBytes(vk.vk_beta_2)};\n\n`;
    
    // Gamma (G2)
    rust += `pub const VK_${upperName}_GAMMA_G2: [u8; 128] = ${g2ToBytes(vk.vk_gamma_2)};\n\n`;
    
    // Delta (G2)
    rust += `pub const VK_${upperName}_DELTA_G2: [u8; 128] = ${g2ToBytes(vk.vk_delta_2)};\n\n`;
    
    // IC points (G1 array)
    rust += `pub const VK_${upperName}_IC: [[u8; 64]; ${vk.IC.length}] = [\n`;
    for (const ic of vk.IC) {
        rust += `    ${g1ToBytes(ic)},\n`;
    }
    rust += `];\n\n`;
    
    rust += `pub const VK_${upperName}_NUM_PUBLIC: usize = ${vk.nPublic};\n`;
    
    return rust;
}

// Generate for all circuits
const circuits = ['deposit', 'withdraw', 'membership'];
let combined = `//! Auto-generated Groth16 verification keys for pSOL v2 circuits\n`;
combined += `//! Generated from circom/snarkjs output\n`;
combined += `//! DO NOT EDIT - regenerate with: node circuits/build/generate_rust_vk.mjs\n\n`;

for (const circuit of circuits) {
    const vkPath = `build/${circuit}_vk.json`;
    if (fs.existsSync(vkPath)) {
        combined += `// ============ ${circuit.toUpperCase()} ============\n`;
        combined += generateRustVk(circuit, vkPath);
        combined += '\n';
        console.log(`✓ Generated VK for ${circuit}`);
    } else {
        console.log(`⚠ Skipping ${circuit} - VK not found`);
    }
}

// Write to Rust file
const outPath = '../programs/psol-privacy-v2/src/crypto/verification_keys.rs';
fs.writeFileSync(outPath, combined);
console.log(`\n✓ Written to ${outPath}`);
