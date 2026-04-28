import { Connection, PublicKey } from "@solana/web3.js";
import { bn254 } from "@noble/curves/bn254";
import * as fs from "fs";

const RPC_URL = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

const FR_MODULUS = bn254.G1.CURVE.n;

function scalarFromDecimal(s: string): bigint {
    const v = BigInt(s);
    if (v >= FR_MODULUS) throw new Error("Scalar overflow");
    return v;
}

function scalarToBytes32BE(v: bigint): Uint8Array {
    const hex = v.toString(16).padStart(64, '0');
    return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function decimalToBytes32BE(s: string): Uint8Array {
    return scalarToBytes32BE(scalarFromDecimal(s));
}

function parseG1(bytes: Uint8Array) {
    const x = BigInt('0x' + Buffer.from(bytes.slice(0, 32)).toString('hex'));
    const y = BigInt('0x' + Buffer.from(bytes.slice(32, 64)).toString('hex'));
    return bn254.G1.ProjectivePoint.fromAffine({ x, y });
}

function parseG2(bytes: Uint8Array) {
    const x_c1 = BigInt('0x' + Buffer.from(bytes.slice(0, 32)).toString('hex'));
    const x_c0 = BigInt('0x' + Buffer.from(bytes.slice(32, 64)).toString('hex'));
    const y_c1 = BigInt('0x' + Buffer.from(bytes.slice(64, 96)).toString('hex'));
    const y_c0 = BigInt('0x' + Buffer.from(bytes.slice(96, 128)).toString('hex'));
    return bn254.G2.ProjectivePoint.fromAffine({
        x: { c0: x_c0, c1: x_c1 },
        y: { c0: y_c0, c1: y_c1 },
    });
}

function g1ToBytes(point: any): Uint8Array {
    const aff = point.toAffine();
    if (aff.x === undefined) return new Uint8Array(64);
    const xBuf = scalarToBytes32BE(aff.x);
    const yBuf = scalarToBytes32BE(aff.y);
    const out = new Uint8Array(64);
    out.set(xBuf, 0);
    out.set(yBuf, 32);
    return out;
}

async function main() {
    const connection = new Connection(RPC_URL, "confirmed");

    // Fetch current on-chain state
    const poolConfigData = await connection.getAccountInfo(POOL_CONFIG);
    if (!poolConfigData) {
        console.log("Pool config not found");
        return;
    }

    const merkleTreePubkey = new PublicKey(poolConfigData.data.slice(8 + 32 + 32, 8 + 32 + 32 + 32));
    const merkleTreeData = await connection.getAccountInfo(merkleTreePubkey);
    if (!merkleTreeData) {
        console.log("Merkle tree not found");
        return;
    }

    const mtData = merkleTreeData.data;
    let mtOffset = 8 + 32 + 1; // skip discriminator, pool, depth
    const nextLeafIndex = mtData.readUInt32LE(mtOffset);
    mtOffset += 4;
    const currentRoot = Buffer.from(mtData.slice(mtOffset, mtOffset + 32));

    const onchainOldRoot = BigInt('0x' + currentRoot.toString('hex'));
    const onchainStartIndex = BigInt(nextLeafIndex);

    console.log("Current on-chain oldRoot:", onchainOldRoot.toString(16).padStart(64, '0'));
    console.log("Current on-chain startIndex:", onchainStartIndex.toString());

    // Read proof
    const proofPath = "./test-proofs/batch_proof.json";
    if (!fs.existsSync(proofPath)) {
        console.log("batch_proof.json not found");
        return;
    }

    const proofData = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const proof = proofData.proof;

    // Read VK
    const vkPath = "../../circuits/merkle_batch_update/build/verification_key.json";
    const vk = JSON.parse(fs.readFileSync(vkPath, "utf8"));

    // Parse proof points
    const piA = parseG1(Uint8Array.from([...decimalToBytes32BE(proof.pi_a[0]), ...decimalToBytes32BE(proof.pi_a[1])]));
    const piB = parseG2(Uint8Array.from([
        ...decimalToBytes32BE(proof.pi_b[0][1]), ...decimalToBytes32BE(proof.pi_b[0][0]),
        ...decimalToBytes32BE(proof.pi_b[1][1]), ...decimalToBytes32BE(proof.pi_b[1][0])
    ]));
    const piC = parseG1(Uint8Array.from([...decimalToBytes32BE(proof.pi_c[0]), ...decimalToBytes32BE(proof.pi_c[1])]));

    // Parse VK points
    const vkAlpha = parseG1(Uint8Array.from([...decimalToBytes32BE(vk.vk_alpha_1[0]), ...decimalToBytes32BE(vk.vk_alpha_1[1])]));
    const vkBeta = parseG2(Uint8Array.from([
        ...decimalToBytes32BE(vk.vk_beta_2[0][1]), ...decimalToBytes32BE(vk.vk_beta_2[0][0]),
        ...decimalToBytes32BE(vk.vk_beta_2[1][1]), ...decimalToBytes32BE(vk.vk_beta_2[1][0])
    ]));
    const vkGamma = parseG2(Uint8Array.from([
        ...decimalToBytes32BE(vk.vk_gamma_2[0][1]), ...decimalToBytes32BE(vk.vk_gamma_2[0][0]),
        ...decimalToBytes32BE(vk.vk_gamma_2[1][1]), ...decimalToBytes32BE(vk.vk_gamma_2[1][0])
    ]));
    const vkDelta = parseG2(Uint8Array.from([
        ...decimalToBytes32BE(vk.vk_delta_2[0][1]), ...decimalToBytes32BE(vk.vk_delta_2[0][0]),
        ...decimalToBytes32BE(vk.vk_delta_2[1][1]), ...decimalToBytes32BE(vk.vk_delta_2[1][0])
    ]));

    // Parse IC
    const icPoints = vk.IC.map((ic: string[]) =>
        parseG1(Uint8Array.from([...decimalToBytes32BE(ic[0]), ...decimalToBytes32BE(ic[1])]))
    );

    // Build CURRENT on-chain public inputs (using stale proof!)
    // We need a new_root and commitmentsHash for the current state.
    // Since we don't have a valid proof for current state, let's just use dummy values
    // that make the proof mathematically invalid.
    const currentInputs = [
        onchainOldRoot,                    // oldRoot
        onchainOldRoot + 1n,               // newRoot (dummy - will make proof invalid)
        onchainStartIndex,                 // startIndex
        1n,                                // batchSize
        123456789n,                        // commitmentsHash (dummy)
    ];

    console.log("\n=== Using CURRENT on-chain public inputs with STALE proof ===");
    console.log("Public inputs:");
    currentInputs.forEach((v, i) => console.log(`  [${i}] ${v.toString()}`));

    // Compute vk_x = IC[0] + Σ(input[i] * IC[i+1])
    let vkX = icPoints[0];
    for (let i = 0; i < currentInputs.length; i++) {
        const inputScalar = currentInputs[i];
        if (inputScalar === 0n) continue;
        const icPoint = icPoints[i + 1];
        const product = icPoint.multiply(inputScalar);
        vkX = vkX.add(product);
    }

    // Negate A
    const negA = bn254.G1.ProjectivePoint.fromAffine({
        x: piA.toAffine().x,
        y: bn254.G1.CURVE.p - piA.toAffine().y,
    });

    // Pairing check
    try {
        const result = bn254.pairingBatch([
            { g1: negA, g2: piB },
            { g1: vkAlpha, g2: vkBeta },
            { g1: vkX, g2: vkGamma },
            { g1: piC, g2: vkDelta },
        ]);

        console.log("\nPairing result:", result);
        if (result) {
            console.log("✅ Pairing PASSES (unexpected for stale proof with wrong inputs!)");
        } else {
            console.log("❌ Pairing FAILS (expected for stale proof with wrong inputs)");
        }
    } catch (e: any) {
        console.log("\nPairing threw error:", e.message);
    }

    // Now also test with the ORIGINAL public inputs to confirm the proof itself is valid
    const originalInputs = proofData.publicSignals.map((s: string) => BigInt(s));
    console.log("\n=== Using ORIGINAL public inputs with STALE proof ===");
    console.log("Public inputs:");
    originalInputs.forEach((v: bigint, i: number) => console.log(`  [${i}] ${v.toString()}`));

    let vkXOriginal = icPoints[0];
    for (let i = 0; i < originalInputs.length; i++) {
        const inputScalar = originalInputs[i];
        if (inputScalar === 0n) continue;
        const icPoint = icPoints[i + 1];
        const product = icPoint.multiply(inputScalar);
        vkXOriginal = vkXOriginal.add(product);
    }

    try {
        const resultOriginal = bn254.pairingBatch([
            { g1: negA, g2: piB },
            { g1: vkAlpha, g2: vkBeta },
            { g1: vkXOriginal, g2: vkGamma },
            { g1: piC, g2: vkDelta },
        ]);

        console.log("\nPairing result:", resultOriginal);
        if (resultOriginal) {
            console.log("✅ Pairing PASSES (proof is valid for original inputs)");
        } else {
            console.log("❌ Pairing FAILS (proof is invalid even for original inputs!)");
        }
    } catch (e: any) {
        console.log("\nPairing threw error:", e.message);
    }
}

main().catch(console.error);
