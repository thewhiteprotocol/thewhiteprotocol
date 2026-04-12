"use strict";
/**
 * pSOL v2 SDK - Proof Generation
 *
 * Generates ZK proofs for deposits, withdrawals, and transfers.
 * Uses snarkjs for Groth16 proof generation.
 *
 * @module proof/prover
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Prover = exports.DEFAULT_CIRCUIT_PATHS = exports.DEFAULT_MERKLE_TREE_DEPTH = exports.ProofType = void 0;
exports.pubkeyToScalar = pubkeyToScalar;
exports.verifyProofLocally = verifyProofLocally;
exports.exportVerificationKey = exportVerificationKey;
const snarkjs = __importStar(require("snarkjs"));
/**
 * Proof type enumeration
 */
var ProofType;
(function (ProofType) {
    ProofType[ProofType["Deposit"] = 0] = "Deposit";
    ProofType[ProofType["Withdraw"] = 1] = "Withdraw";
    ProofType[ProofType["JoinSplit"] = 2] = "JoinSplit";
    ProofType[ProofType["Membership"] = 3] = "Membership";
})(ProofType || (exports.ProofType = ProofType = {}));
/** Default Merkle tree depth (must match circuits) */
exports.DEFAULT_MERKLE_TREE_DEPTH = 20;
/**
 * Default circuit paths (relative to project root)
 */
exports.DEFAULT_CIRCUIT_PATHS = {
    [ProofType.Deposit]: {
        wasmPath: 'circuits/build/deposit_js/deposit.wasm',
        zkeyPath: 'circuits/build/deposit.zkey',
    },
    [ProofType.Withdraw]: {
        wasmPath: 'circuits/build/withdraw_js/withdraw.wasm',
        zkeyPath: 'circuits/build/withdraw.zkey',
    },
    [ProofType.JoinSplit]: {
        wasmPath: 'circuits/build/joinsplit_js/joinsplit.wasm',
        zkeyPath: 'circuits/build/joinsplit.zkey',
    },
    [ProofType.Membership]: {
        wasmPath: 'circuits/build/membership_js/membership.wasm',
        zkeyPath: 'circuits/build/membership.zkey',
    },
};
/**
 * Prover class for generating ZK proofs
 */
class Prover {
    constructor(circuitPaths, merkleTreeDepth = exports.DEFAULT_MERKLE_TREE_DEPTH) {
        this.circuitPaths = {
            ...exports.DEFAULT_CIRCUIT_PATHS,
            ...circuitPaths,
        };
        this.merkleTreeDepth = merkleTreeDepth;
    }
    /**
     * Generate deposit proof
     */
    async generateDepositProof(inputs) {
        this.assertCircuitArtifactsExist(ProofType.Deposit);
        const circuitInputs = {
            commitment: inputs.commitment.toString(),
            amount: inputs.amount.toString(),
            asset_id: inputs.assetId.toString(),
            secret: inputs.secret.toString(),
            nullifier: inputs.nullifier.toString(),
        };
        const paths = this.circuitPaths[ProofType.Deposit];
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, paths.wasmPath, paths.zkeyPath);
        return this.serializeProof(proof, publicSignals);
    }
    /**
     * Generate withdrawal proof
     */
    async generateWithdrawProof(inputs) {
        this.assertCircuitArtifactsExist(ProofType.Withdraw);
        this.assertMerkleDepth(inputs.merkleProof.pathElements.length, 'withdraw');
        const circuitInputs = {
            // Public inputs
            merkle_root: inputs.merkleRoot.toString(),
            nullifier_hash: inputs.nullifierHash.toString(),
            asset_id: inputs.assetId.toString(),
            recipient: pubkeyToScalar(inputs.recipient).toString(),
            amount: inputs.amount.toString(),
            relayer: pubkeyToScalar(inputs.relayer).toString(),
            relayer_fee: inputs.relayerFee.toString(),
            public_data_hash: inputs.publicDataHash.toString(),
            // Private inputs
            secret: inputs.secret.toString(),
            nullifier: inputs.nullifier.toString(),
            leaf_index: inputs.leafIndex.toString(),
            merkle_path: inputs.merkleProof.pathElements.map(e => e.toString()),
            merkle_path_indices: inputs.merkleProof.pathIndices.map(i => i.toString()),
        };
        const paths = this.circuitPaths[ProofType.Withdraw];
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, paths.wasmPath, paths.zkeyPath);
        return this.serializeProof(proof, publicSignals);
    }
    /**
     * Generate JoinSplit proof
     */
    async generateJoinSplitProof(inputs) {
        this.assertCircuitArtifactsExist(ProofType.JoinSplit);
        if (inputs.inputNotes.length !== 2 || inputs.outputNotes.length !== 2) {
            throw new Error('JoinSplit requires exactly 2 inputs and 2 outputs');
        }
        for (const proof of inputs.inputMerkleProofs) {
            this.assertMerkleDepth(proof.pathElements.length, 'joinsplit');
        }
        const circuitInputs = {
            merkle_root: inputs.merkleRoot.toString(),
            asset_id: inputs.assetId.toString(),
            input_nullifiers: inputs.inputNotes.map(n => n.nullifierHash.toString()),
            output_commitments: inputs.outputNotes.map(n => n.commitment.toString()),
            public_amount: inputs.publicAmount.toString(),
            relayer: pubkeyToScalar(inputs.relayer).toString(),
            relayer_fee: inputs.relayerFee.toString(),
            // Private inputs
            input_secrets: inputs.inputNotes.map(n => n.secret.toString()),
            input_nullifier_preimages: inputs.inputNotes.map(n => n.nullifier.toString()),
            input_amounts: inputs.inputNotes.map(n => n.amount.toString()),
            input_leaf_indices: inputs.inputNotes.map(n => n.leafIndex.toString()),
            input_merkle_paths: inputs.inputMerkleProofs.map(p => p.pathElements.map(e => e.toString())),
            input_path_indices: inputs.inputMerkleProofs.map(p => p.pathIndices.map(i => i.toString())),
            output_secrets: inputs.outputNotes.map(n => n.secret.toString()),
            output_nullifier_preimages: inputs.outputNotes.map(n => n.nullifier.toString()),
            output_amounts: inputs.outputNotes.map(n => n.amount.toString()),
        };
        const paths = this.circuitPaths[ProofType.JoinSplit];
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(circuitInputs, paths.wasmPath, paths.zkeyPath);
        return this.serializeProof(proof, publicSignals);
    }
    /**
     * Serialize Groth16 proof to 256 bytes for on-chain verification
     */
    serializeProof(proof, publicSignals) {
        const proofData = new Uint8Array(256);
        // A point (G1): x, y each 32 bytes
        const ax = hexToBytes32(bigIntToHex(BigInt(proof.pi_a[0])));
        const ay = hexToBytes32(bigIntToHex(BigInt(proof.pi_a[1])));
        proofData.set(ax, 0);
        proofData.set(ay, 32);
        // B point (G2): x = (x0, x1), y = (y0, y1) each 32 bytes
        const bx0 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[0][1])));
        const bx1 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[0][0])));
        const by0 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[1][1])));
        const by1 = hexToBytes32(bigIntToHex(BigInt(proof.pi_b[1][0])));
        proofData.set(bx0, 64);
        proofData.set(bx1, 96);
        proofData.set(by0, 128);
        proofData.set(by1, 160);
        // C point (G1): x, y each 32 bytes
        const cx = hexToBytes32(bigIntToHex(BigInt(proof.pi_c[0])));
        const cy = hexToBytes32(bigIntToHex(BigInt(proof.pi_c[1])));
        proofData.set(cx, 192);
        proofData.set(cy, 224);
        const publicInputs = publicSignals.map(s => BigInt(s));
        return { proofData, publicInputs };
    }
    assertMerkleDepth(actualDepth, proofType) {
        if (actualDepth !== this.merkleTreeDepth) {
            throw new Error(`Merkle depth mismatch for ${proofType} proof: expected ${this.merkleTreeDepth}, got ${actualDepth}`);
        }
    }
    assertCircuitArtifactsExist(proofType) {
        // Skip check in browser environment
        if (typeof globalThis !== 'undefined' && 'window' in globalThis)
            return;
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const fs = require('fs');
            const paths = this.circuitPaths[proofType];
            if (!fs.existsSync(paths.wasmPath)) {
                throw new Error(`Missing ${ProofType[proofType]} circuit wasm at ${paths.wasmPath}. Run: cd circuits && ./build.sh`);
            }
            if (!fs.existsSync(paths.zkeyPath)) {
                throw new Error(`Missing ${ProofType[proofType]} circuit zkey at ${paths.zkeyPath}. Run: cd circuits && ./build.sh`);
            }
        }
        catch (e) {
            // fs not available (browser), skip check
            if (e.code === 'MODULE_NOT_FOUND')
                return;
            throw e;
        }
    }
}
exports.Prover = Prover;
/**
 * Convert Solana PublicKey to scalar field element (canonical on-chain encoding)
 *
 * CANONICAL ENCODING (matches on-chain exactly):
 * scalar_bytes = 0x00 || pubkey_bytes[0..31]
 *
 * This drops the last byte of the pubkey and prefixes with 0x00 to ensure
 * the value fits in the BN254 scalar field without reduction.
 */
function pubkeyToScalar(pubkey) {
    const bytes = pubkey.toBytes();
    const scalarBytes = new Uint8Array(32);
    // 0x00 prefix + first 31 bytes of pubkey
    scalarBytes.set(bytes.slice(0, 31), 1);
    let result = 0n;
    for (let i = 0; i < scalarBytes.length; i++) {
        result = (result << 8n) | BigInt(scalarBytes[i]);
    }
    return result;
}
/**
 * Convert bigint to hex string
 */
function bigIntToHex(value) {
    return value.toString(16).padStart(64, '0');
}
/**
 * Convert hex string to 32-byte array
 */
function hexToBytes32(hex) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}
/**
 * Verify proof locally (for testing)
 */
async function verifyProofLocally(proofType, proof, publicSignals, vkeyPath) {
    const vkey = await fetch(vkeyPath).then(r => r.json());
    return snarkjs.groth16.verify(vkey, publicSignals, proof);
}
/**
 * Export verification key from zkey file
 */
async function exportVerificationKey(zkeyPath) {
    return snarkjs.zKey.exportVerificationKey(zkeyPath);
}
