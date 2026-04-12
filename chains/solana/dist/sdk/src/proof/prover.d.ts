/**
 * pSOL v2 SDK - Proof Generation
 *
 * Generates ZK proofs for deposits, withdrawals, and transfers.
 * Uses snarkjs for Groth16 proof generation.
 *
 * @module proof/prover
 */
import { Note, NoteWithNullifier } from '../note/note';
import { MerkleProof } from '../merkle/tree';
import { PublicKey } from '@solana/web3.js';
/**
 * Proof type enumeration
 */
export declare enum ProofType {
    Deposit = 0,
    Withdraw = 1,
    JoinSplit = 2,
    Membership = 3
}
/**
 * Groth16 proof structure
 */
export interface Groth16Proof {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
}
/**
 * Proof with public signals
 */
export interface ProofWithSignals {
    proof: Groth16Proof;
    publicSignals: string[];
}
/**
 * Serialized proof for on-chain submission (256 bytes)
 */
export interface SerializedProof {
    proofData: Uint8Array;
    publicInputs: bigint[];
}
/**
 * Deposit proof inputs
 */
export interface DepositProofInputs {
    commitment: bigint;
    amount: bigint;
    assetId: bigint;
    secret: bigint;
    nullifier: bigint;
}
/**
 * Withdraw proof inputs
 */
export interface WithdrawProofInputs {
    merkleRoot: bigint;
    nullifierHash: bigint;
    assetId: bigint;
    recipient: PublicKey;
    amount: bigint;
    relayer: PublicKey;
    relayerFee: bigint;
    publicDataHash: bigint;
    secret: bigint;
    nullifier: bigint;
    leafIndex: number;
    merkleProof: MerkleProof;
}
/**
 * JoinSplit proof inputs
 */
export interface JoinSplitProofInputs {
    merkleRoot: bigint;
    assetId: bigint;
    inputNotes: NoteWithNullifier[];
    outputNotes: Note[];
    publicAmount: bigint;
    relayer: PublicKey;
    relayerFee: bigint;
    inputMerkleProofs: MerkleProof[];
}
/**
 * Circuit files paths
 */
export interface CircuitPaths {
    wasmPath: string;
    zkeyPath: string;
}
/** Default Merkle tree depth (must match circuits) */
export declare const DEFAULT_MERKLE_TREE_DEPTH = 20;
/**
 * Default circuit paths (relative to project root)
 */
export declare const DEFAULT_CIRCUIT_PATHS: Record<ProofType, CircuitPaths>;
/**
 * Prover class for generating ZK proofs
 */
export declare class Prover {
    private circuitPaths;
    private merkleTreeDepth;
    constructor(circuitPaths?: Partial<Record<ProofType, CircuitPaths>>, merkleTreeDepth?: number);
    /**
     * Generate deposit proof
     */
    generateDepositProof(inputs: DepositProofInputs): Promise<SerializedProof>;
    /**
     * Generate withdrawal proof
     */
    generateWithdrawProof(inputs: WithdrawProofInputs): Promise<SerializedProof>;
    /**
     * Generate JoinSplit proof
     */
    generateJoinSplitProof(inputs: JoinSplitProofInputs): Promise<SerializedProof>;
    /**
     * Serialize Groth16 proof to 256 bytes for on-chain verification
     */
    private serializeProof;
    private assertMerkleDepth;
    private assertCircuitArtifactsExist;
}
/**
 * Convert Solana PublicKey to scalar field element (canonical on-chain encoding)
 *
 * CANONICAL ENCODING (matches on-chain exactly):
 * scalar_bytes = 0x00 || pubkey_bytes[0..31]
 *
 * This drops the last byte of the pubkey and prefixes with 0x00 to ensure
 * the value fits in the BN254 scalar field without reduction.
 */
export declare function pubkeyToScalar(pubkey: PublicKey): bigint;
/**
 * Verify proof locally (for testing)
 */
export declare function verifyProofLocally(proofType: ProofType, proof: Groth16Proof, publicSignals: string[], vkeyPath: string): Promise<boolean>;
/**
 * Export verification key from zkey file
 */
export declare function exportVerificationKey(zkeyPath: string): Promise<any>;
//# sourceMappingURL=prover.d.ts.map