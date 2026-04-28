import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";

const RPC_URL = process.env.SOLANA_RPC || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
    const connection = new Connection(RPC_URL, "confirmed");

    // Fetch pool config to get merkle tree address
    const poolConfigData = await connection.getAccountInfo(POOL_CONFIG);
    if (!poolConfigData) {
        console.log("Pool config not found");
        return;
    }

    // PoolConfig layout: discriminator(8) + authority(32) + pending_authority(32) + merkle_tree(32) + ...
    const merkleTreePubkey = new PublicKey(poolConfigData.data.slice(8 + 32 + 32, 8 + 32 + 32 + 32));
    console.log("Merkle tree:", merkleTreePubkey.toBase58());

    // Fetch merkle tree
    const merkleTreeData = await connection.getAccountInfo(merkleTreePubkey);
    if (!merkleTreeData) {
        console.log("Merkle tree not found");
        return;
    }

    // MerkleTree layout (from state/merkle_tree.rs):
    // discriminator(8) + pool(32) + depth(1) + next_leaf_index(4) + current_root(32) + ...
    const mtData = merkleTreeData.data;
    let mtOffset = 8; // skip discriminator
    mtOffset += 32; // pool
    const depth = mtData[mtOffset];
    mtOffset += 1;
    const nextLeafIndex = mtData.readUInt32LE(mtOffset);
    mtOffset += 4;
    const currentRoot = Buffer.from(mtData.slice(mtOffset, mtOffset + 32));
    mtOffset += 32;

    console.log("=== On-Chain State ===");
    console.log("Tree depth:", depth);
    console.log("Current root:", currentRoot.toString('hex'));
    console.log("Next leaf index:", nextLeafIndex);

    // Fetch pending deposits buffer
    const [pendingPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending_deposits"), POOL_CONFIG.toBuffer()],
        PROGRAM_ID
    );
    console.log("\nPending buffer PDA:", pendingPda.toBase58());

    const pendingData = await connection.getAccountInfo(pendingPda);
    if (!pendingData) {
        console.log("Pending buffer not found");
    } else {
        // PendingDepositsBuffer layout:
        // discriminator(8) + pool(32) + bump(1) + size(4) + deposits(vec) + last_cleared_at(8)
        const pdData = pendingData.data;
        let pdOffset = 8; // skip discriminator
        pdOffset += 32; // pool
        const bump = pdData[pdOffset];
        pdOffset += 1;
        const size = pdData.readUInt32LE(pdOffset);
        pdOffset += 4;
        // Vec layout: length (4 bytes) + elements
        const depositsLen = pdData.readUInt32LE(pdOffset);
        pdOffset += 4;

        console.log("Pending buffer size:", size);
        console.log("Deposits array length:", depositsLen);

        // Each deposit: commitment(32) + timestamp(8) + asset_id(32)
        const depositSize = 32 + 8 + 32;
        for (let i = 0; i < Math.min(size, 5); i++) {
            const commitment = pdData.slice(pdOffset + i * depositSize, pdOffset + i * depositSize + 32);
            console.log(`Deposit[${i}] commitment:`, commitment.toString('hex'));
        }
    }

    // Read batch_proof.json
    const proofPath = "./test-proofs/batch_proof.json";
    if (!fs.existsSync(proofPath)) {
        console.log("\nbatch_proof.json not found at", proofPath);
        return;
    }

    const proofData = JSON.parse(fs.readFileSync(proofPath, "utf8"));
    const publicSignals = proofData.publicSignals.map((s: string) => BigInt(s));

    console.log("\n=== Proof Public Signals ===");
    console.log("[0] oldRoot:     ", publicSignals[0].toString(16).padStart(64, '0'));
    console.log("[1] newRoot:     ", publicSignals[1].toString(16).padStart(64, '0'));
    console.log("[2] startIndex:  ", publicSignals[2].toString());
    console.log("[3] batchSize:   ", publicSignals[3].toString());
    console.log("[4] commitmentsHash:", publicSignals[4].toString(16).padStart(64, '0'));

    // Compare
    const onchainOldRoot = BigInt('0x' + currentRoot.toString('hex'));
    const onchainStartIndex = BigInt(nextLeafIndex);

    console.log("\n=== Comparison ===");
    console.log("oldRoot matches:", publicSignals[0] === onchainOldRoot);
    console.log("startIndex matches:", publicSignals[2] === onchainStartIndex);

    if (publicSignals[0] !== onchainOldRoot) {
        console.log("\n  Proof oldRoot:  ", publicSignals[0].toString(16).padStart(64, '0'));
        console.log("  On-chain root:  ", onchainOldRoot.toString(16).padStart(64, '0'));
    }

    if (publicSignals[2] !== onchainStartIndex) {
        console.log("\n  Proof startIndex:", publicSignals[2].toString());
        console.log("  On-chain index:  ", onchainStartIndex.toString());
    }
}

main().catch(console.error);
