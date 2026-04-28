import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
    const connection = new Connection(RPC_URL, "confirmed");
    const fs = require("fs");

    // Find VK PDA
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

    const data = accountInfo.data;
    let offset = 8; // skip discriminator

    offset += 32; // pool
    offset += 1;  // proof_type

    const onchainAlphaG1 = Buffer.from(data.slice(offset, offset + 64));
    offset += 64;

    const onchainBetaG2 = Buffer.from(data.slice(offset, offset + 128));
    offset += 128;

    const onchainGammaG2 = Buffer.from(data.slice(offset, offset + 128));
    offset += 128;

    const onchainDeltaG2 = Buffer.from(data.slice(offset, offset + 128));
    offset += 128;

    const vkIcLen = data[offset];
    offset += 1;

    const vkIcVecLen = data.readUInt32LE(offset);
    offset += 4;

    const onchainIc: Buffer[] = [];
    for (let i = 0; i < vkIcVecLen; i++) {
        onchainIc.push(Buffer.from(data.slice(offset, offset + 64)));
        offset += 64;
    }

    // Read local VK
    const localVkPath = "../../circuits/merkle_batch_update/build/verification_key.json";
    if (!fs.existsSync(localVkPath)) {
        console.log("Local VK not found at", localVkPath);
        return;
    }

    const localVk = JSON.parse(fs.readFileSync(localVkPath, "utf8"));

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

    console.log("\n=== VK Byte Comparison ===");
    console.log("Alpha G1 matches:", onchainAlphaG1.equals(localAlpha));
    if (!onchainAlphaG1.equals(localAlpha)) {
        console.log("  On-chain:", onchainAlphaG1.toString('hex').slice(0, 64) + "...");
        console.log("  Local:  ", localAlpha.toString('hex').slice(0, 64) + "...");
    }

    console.log("Beta G2 matches:", onchainBetaG2.equals(localBeta));
    if (!onchainBetaG2.equals(localBeta)) {
        console.log("  On-chain:", onchainBetaG2.toString('hex').slice(0, 64) + "...");
        console.log("  Local:  ", localBeta.toString('hex').slice(0, 64) + "...");
    }

    console.log("Gamma G2 matches:", onchainGammaG2.equals(localGamma));
    if (!onchainGammaG2.equals(localGamma)) {
        console.log("  On-chain:", onchainGammaG2.toString('hex').slice(0, 64) + "...");
        console.log("  Local:  ", localGamma.toString('hex').slice(0, 64) + "...");
    }

    console.log("Delta G2 matches:", onchainDeltaG2.equals(localDelta));
    if (!onchainDeltaG2.equals(localDelta)) {
        console.log("  On-chain:", onchainDeltaG2.toString('hex').slice(0, 64) + "...");
        console.log("  Local:  ", localDelta.toString('hex').slice(0, 64) + "...");
    }

    console.log("IC count - On-chain:", onchainIc.length, "Local:", localVk.IC.length);
    for (let i = 0; i < Math.max(onchainIc.length, localVk.IC.length); i++) {
        const localIc = i < localVk.IC.length ? vkG1ToBytes(localVk.IC[i]) : null;
        const onchainIc_i = i < onchainIc.length ? onchainIc[i] : null;
        const match = localIc && onchainIc_i ? localIc.equals(onchainIc_i) : false;
        console.log(`IC[${i}] matches:`, match);
        if (!match && localIc && onchainIc_i) {
            console.log("  On-chain:", onchainIc_i.toString('hex').slice(0, 64) + "...");
            console.log("  Local:  ", localIc.toString('hex').slice(0, 64) + "...");
        }
    }

    // Also check the other build directory
    const altVkPath = "../../circuits/build/merkle_batch_update/verification_key.json";
    if (fs.existsSync(altVkPath)) {
        const altVk = JSON.parse(fs.readFileSync(altVkPath, "utf8"));
        const altAlpha = vkG1ToBytes(altVk.vk_alpha_1);
        const altBeta = vkG2ToBytes(altVk.vk_beta_2);
        const altGamma = vkG2ToBytes(altVk.vk_gamma_2);
        const altDelta = vkG2ToBytes(altVk.vk_delta_2);

        console.log("\n=== Alternative Build Directory (circuits/build/merkle_batch_update/) ===");
        console.log("Alpha matches on-chain:", onchainAlphaG1.equals(altAlpha));
        console.log("Beta matches on-chain:", onchainBetaG2.equals(altBeta));
        console.log("Gamma matches on-chain:", onchainGammaG2.equals(altGamma));
        console.log("Delta matches on-chain:", onchainDeltaG2.equals(altDelta));

        for (let i = 0; i < Math.min(onchainIc.length, altVk.IC.length); i++) {
            const altIc = vkG1ToBytes(altVk.IC[i]);
            console.log(`IC[${i}] matches on-chain:`, onchainIc[i].equals(altIc));
        }
    }
}

main().catch(console.error);
