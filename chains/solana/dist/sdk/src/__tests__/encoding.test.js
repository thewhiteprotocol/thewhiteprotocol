"use strict";
/**
 * Encoding Tests - Validates SS-1 and SS-2 Audit Fixes
 *
 * These tests ensure SDK encoding matches on-chain expectations exactly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const keccak_1 = require("../crypto/keccak");
const prover_1 = require("../proof/prover");
describe("Encoding Compatibility", () => {
    describe("SS-1: Asset ID Derivation", () => {
        it("produces 32-byte output", () => {
            const mint = new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"); // USDC
            const assetId = (0, keccak_1.deriveAssetId)(mint);
            expect(assetId.length).toBe(32);
        });
        it("has 0x00 prefix (first byte is 0)", () => {
            const mint = new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
            const assetId = (0, keccak_1.deriveAssetId)(mint);
            expect(assetId[0]).toBe(0);
        });
        it("is deterministic", () => {
            const mint = new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
            const id1 = (0, keccak_1.deriveAssetId)(mint);
            const id2 = (0, keccak_1.deriveAssetId)(mint);
            expect(Buffer.from(id1).toString("hex")).toBe(Buffer.from(id2).toString("hex"));
        });
        it("different mints produce different asset IDs", () => {
            const usdc = new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
            const wsol = new web3_js_1.PublicKey("So11111111111111111111111111111111111111112");
            const usdcId = (0, keccak_1.deriveAssetId)(usdc);
            const wsolId = (0, keccak_1.deriveAssetId)(wsol);
            expect(Buffer.from(usdcId).toString("hex")).not.toBe(Buffer.from(wsolId).toString("hex"));
        });
        it("fits in BN254 scalar field (< 2^254)", () => {
            const mint = new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
            const assetId = (0, keccak_1.deriveAssetId)(mint);
            // With 0x00 prefix, max value is 2^248 - 1, well under Fr
            // First byte must be 0
            expect(assetId[0]).toBe(0);
            // Convert to bigint and check < Fr
            const FR_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
            let value = BigInt(0);
            for (let i = 0; i < assetId.length; i++) {
                value = (value << 8n) | BigInt(assetId[i]);
            }
            expect(value < FR_MODULUS).toBe(true);
        });
    });
    describe("SS-2: Pubkey to Scalar Encoding", () => {
        it("produces value fitting in BN254 scalar field", () => {
            const pubkey = new web3_js_1.PublicKey("11111111111111111111111111111111");
            const scalar = (0, prover_1.pubkeyToScalar)(pubkey);
            const FR_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
            expect(scalar < FR_MODULUS).toBe(true);
        });
        it("uses 0x00 prefix encoding (drops last byte of pubkey)", () => {
            // Create a pubkey with known bytes
            const bytes = new Uint8Array(32);
            bytes.fill(0xff); // All 1s
            bytes[31] = 0xaa; // Last byte different
            const pubkey = new web3_js_1.PublicKey(bytes);
            const scalar = (0, prover_1.pubkeyToScalar)(pubkey);
            // Reconstructed scalar should have 0x00 prefix + first 31 bytes
            // So the last byte (0xaa) should NOT appear in scalar
            // And first 31 bytes (0xff) should be there
            // Convert scalar back to bytes to verify structure
            const scalarHex = scalar.toString(16).padStart(64, "0");
            // First 2 chars should be 00 (0x00 prefix)
            expect(scalarHex.slice(0, 2)).toBe("00");
            // Middle should be ff bytes
            for (let i = 2; i < 64; i += 2) {
                expect(scalarHex.slice(i, i + 2)).toBe("ff");
            }
        });
        it("is deterministic", () => {
            const pubkey = new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
            const s1 = (0, prover_1.pubkeyToScalar)(pubkey);
            const s2 = (0, prover_1.pubkeyToScalar)(pubkey);
            expect(s1).toBe(s2);
        });
        it("different pubkeys produce different scalars", () => {
            const pk1 = new web3_js_1.PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
            const pk2 = new web3_js_1.PublicKey("So11111111111111111111111111111111111111112");
            const s1 = (0, prover_1.pubkeyToScalar)(pk1);
            const s2 = (0, prover_1.pubkeyToScalar)(pk2);
            expect(s1).not.toBe(s2);
        });
        it("handles edge case: all-zero pubkey", () => {
            const pubkey = new web3_js_1.PublicKey(new Uint8Array(32));
            const scalar = (0, prover_1.pubkeyToScalar)(pubkey);
            expect(scalar).toBe(0n);
        });
    });
});
