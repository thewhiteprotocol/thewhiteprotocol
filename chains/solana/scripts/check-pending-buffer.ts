import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW");
const POOL_CONFIG = new PublicKey("EYjYoV3RpvmYBcUi6LVGaYUzCbEjeHxga7nE7D5GEgaS");

async function main() {
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");

    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("pending"), POOL_CONFIG.toBuffer()],
        PROGRAM_ID
    );
    console.log("Pending buffer PDA:", pda.toBase58());

    const info = await conn.getAccountInfo(pda);
    if (info) {
        console.log("Account exists, size:", info.data.length);
        const data = info.data;
        let offset = 8 + 32 + 1; // skip discriminator, pool, bump
        const size = data.readUInt32LE(offset);
        console.log("Pending deposits size:", size);

        // Print commitments
        offset += 4;
        const depositsLen = data.readUInt32LE(offset);
        offset += 4;
        const depositSize = 32 + 8 + 32;
        for (let i = 0; i < Math.min(size, 10); i++) {
            const commitment = data.slice(offset + i * depositSize, offset + i * depositSize + 32);
            console.log(`Deposit[${i}] commitment:`, Buffer.from(commitment).toString('hex'));
        }
    } else {
        console.log("Account not found");
    }
}

main().catch(console.error);
