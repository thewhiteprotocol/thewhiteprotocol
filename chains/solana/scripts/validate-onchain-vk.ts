import { Connection, PublicKey } from "@solana/web3.js";
import { bn254 } from "@noble/curves/bn254";

const RPC_URL = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

const FP_MODULUS = bn254.G1.CURVE.p;
const CURVE_ORDER = bn254.G1.CURVE.n;

function isValidFp(value: bigint): boolean {
    return value >= 0n && value < FP_MODULUS;
}

function validateG1(bytes: Buffer): { valid: boolean; inSubgroup: boolean; zero: boolean; error?: string } {
    const x = BigInt('0x' + bytes.slice(0, 32).toString('hex'));
    const y = BigInt('0x' + bytes.slice(32, 64).toString('hex'));

    if (x === 0n && y === 0n) {
        return { valid: true, inSubgroup: true, zero: true };
    }

    if (!isValidFp(x) || !isValidFp(y)) {
        return { valid: false, inSubgroup: false, zero: false, error: "Coordinate >= Fp modulus" };
    }

    try {
        const point = bn254.G1.ProjectivePoint.fromAffine({ x, y });
        // Subgroup check: multiply by curve order
        const scaled = point.multiply(CURVE_ORDER);
        const inSubgroup = scaled.equals(bn254.G1.ProjectivePoint.ZERO);
        return { valid: true, inSubgroup, zero: false };
    } catch (e: any) {
        return { valid: false, inSubgroup: false, zero: false, error: e.message };
    }
}

function validateG2(bytes: Buffer): { valid: boolean; inSubgroup: boolean; zero: boolean; error?: string } {
    const x_c1 = BigInt('0x' + bytes.slice(0, 32).toString('hex'));
    const x_c0 = BigInt('0x' + bytes.slice(32, 64).toString('hex'));
    const y_c1 = BigInt('0x' + bytes.slice(64, 96).toString('hex'));
    const y_c0 = BigInt('0x' + bytes.slice(96, 128).toString('hex'));

    if (x_c0 === 0n && x_c1 === 0n && y_c0 === 0n && y_c1 === 0n) {
        return { valid: true, inSubgroup: true, zero: true };
    }

    if (!isValidFp(x_c0) || !isValidFp(x_c1) || !isValidFp(y_c0) || !isValidFp(y_c1)) {
        return { valid: false, inSubgroup: false, zero: false, error: "Coordinate >= Fp modulus" };
    }

    try {
        const point = bn254.G2.ProjectivePoint.fromAffine({
            x: { c0: x_c0, c1: x_c1 },
            y: { c0: y_c0, c1: y_c1 },
        });
        const scaled = point.multiply(CURVE_ORDER);
        const inSubgroup = scaled.equals(bn254.G2.ProjectivePoint.ZERO);
        return { valid: true, inSubgroup, zero: false };
    } catch (e: any) {
        return { valid: false, inSubgroup: false, zero: false, error: e.message };
    }
}

async function main() {
    const connection = new Connection(RPC_URL, "confirmed");

    const [vkPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vk_merkle_batch"), POOL_CONFIG.toBuffer()],
        PROGRAM_ID
    );

    console.log("VK PDA:", vkPda.toBase58());

    const accountInfo = await connection.getAccountInfo(vkPda);
    if (!accountInfo) {
        console.log("VK account not found!");
        return;
    }

    console.log("Account data length:", accountInfo.data.length);

    const data = accountInfo.data;
    let offset = 8;

    offset += 32; // pool
    const proofType = data[offset];
    offset += 1;

    const alphaG1 = Buffer.from(data.slice(offset, offset + 64));
    offset += 64;

    const betaG2 = Buffer.from(data.slice(offset, offset + 128));
    offset += 128;

    const gammaG2 = Buffer.from(data.slice(offset, offset + 128));
    offset += 128;

    const deltaG2 = Buffer.from(data.slice(offset, offset + 128));
    offset += 128;

    const vkIcLen = data[offset];
    offset += 1;

    const vkIcVecLen = data.readUInt32LE(offset);
    offset += 4;

    const ic: Buffer[] = [];
    for (let i = 0; i < vkIcVecLen; i++) {
        ic.push(Buffer.from(data.slice(offset, offset + 64)));
        offset += 64;
    }

    console.log("\n=== VK Account Info ===");
    console.log("Proof type:", proofType);
    console.log("IC length (stored):", vkIcLen);
    console.log("IC vec length:", vkIcVecLen);

    console.log("\n=== Validating VK Points ===");

    console.log("\nAlpha G1:");
    const alpha = validateG1(alphaG1);
    console.log("  Valid:", alpha.valid, "InSubgroup:", alpha.inSubgroup, "Zero:", alpha.zero);
    if (alpha.error) console.log("  Error:", alpha.error);

    console.log("\nBeta G2:");
    const beta = validateG2(betaG2);
    console.log("  Valid:", beta.valid, "InSubgroup:", beta.inSubgroup, "Zero:", beta.zero);
    if (beta.error) console.log("  Error:", beta.error);

    console.log("\nGamma G2:");
    const gamma = validateG2(gammaG2);
    console.log("  Valid:", gamma.valid, "InSubgroup:", gamma.inSubgroup, "Zero:", gamma.zero);
    if (gamma.error) console.log("  Error:", gamma.error);

    console.log("\nDelta G2:");
    const delta = validateG2(deltaG2);
    console.log("  Valid:", delta.valid, "InSubgroup:", delta.inSubgroup, "Zero:", delta.zero);
    if (delta.error) console.log("  Error:", delta.error);

    console.log("\nIC Points (", ic.length, "):");
    for (let i = 0; i < ic.length; i++) {
        const p = validateG1(ic[i]);
        console.log(`  IC[${i}]: Valid=${p.valid}, InSubgroup=${p.inSubgroup}, Zero=${p.zero}`);
        if (p.error) console.log(`    Error:`, p.error);
    }

    // Compare with local VK
    const fs = require("fs");
    const localVkPath = "../../../circuits/merkle_batch_update/build/verification_key.json";
    if (fs.existsSync(localVkPath)) {
        const localVk = JSON.parse(fs.readFileSync(localVkPath, "utf8"));
        console.log("\n=== Comparing with Local VK ===");

        function vkG1ToBytes(point: string[]): Buffer {
            const x = BigInt(point[0]).toString(16).padStart(64, '0');
            const y = BigInt(point[1]).toString(16).padStart(64, '0');
            return Buffer.from(x + y, 'hex');
        }

        function vkG2ToBytes(point: string[][]): Buffer {
            const x_c0 = BigInt(point[0][0]).toString(16).padStart(64, '0');
            const x_c1 = BigInt(point[0][1]).toString(16).padStart(64, '0');
            const y_c0 = BigInt(point[1][0]).toString(16).padStart(64, '0');
            const y_c1 = BigInt(point[1][1]).toString(16).padStart(64, '0');
            return Buffer.from(x_c1 + x_c0 + y_c1 + y_c0, 'hex');
        }

        const localAlpha = vkG1ToBytes(localVk.vk_alpha_1);
        const localBeta = vkG2ToBytes(localVk.vk_beta_2);
        const localGamma = vkG2ToBytes(localVk.vk_gamma_2);
        const localDelta = vkG2ToBytes(localVk.vk_delta_2);

        console.log("Alpha matches:", alphaG1.equals(localAlpha));
        console.log("Beta matches:", betaG2.equals(localBeta));
        console.log("Gamma matches:", gammaG2.equals(localGamma));
        console.log("Delta matches:", deltaG2.equals(localDelta));

        for (let i = 0; i < Math.min(ic.length, localVk.IC.length); i++) {
            const localIc = vkG1ToBytes(localVk.IC[i]);
            console.log(`IC[${i}] matches:`, ic[i].equals(localIc));
        }
    }
}

main().catch(console.error);
