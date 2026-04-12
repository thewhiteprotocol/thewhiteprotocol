/**
 * pSOL v2 SDK Client
 *
 * Simplified client for interacting with the pSOL v2 MASP protocol
 */
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, TransactionSignature } from '@solana/web3.js';
import { ProofType } from './types';
/** Default program ID */
/**
 * Options for creating a PsolV2Client
 */
export interface PsolV2ClientOptions {
    provider?: AnchorProvider;
    connection?: Connection;
    wallet?: Keypair;
    programId?: PublicKey;
    idl?: any;
}
/**
 * Main client for interacting with the pSOL v2 MASP protocol
 */
export declare class PsolV2Client {
    readonly program: Program;
    readonly provider: AnchorProvider;
    readonly programId: PublicKey;
    constructor(options: PsolV2ClientOptions);
    /**
     * Get authority public key
     */
    get authority(): PublicKey;
    /**
     * Initialize a new MASP pool
     */
    initializePool(treeDepth: number, rootHistorySize: number): Promise<{
        signature: TransactionSignature;
        poolConfig: PublicKey;
        merkleTree: PublicKey;
    }>;
    /**
     * Initialize pool registries (relayer registry, compliance config)
     */
    initializePoolRegistries(poolConfig: PublicKey): Promise<TransactionSignature>;
    /**
     * Register an asset (SPL token) in the pool
     */
    registerAsset(poolConfig: PublicKey, mint: PublicKey): Promise<TransactionSignature>;
    /**
     * Set verification key for a proof type
     */
    setVerificationKey(poolConfig: PublicKey, proofType: ProofType, vkAlphaG1: Uint8Array, vkBetaG2: Uint8Array, vkGammaG2: Uint8Array, vkDeltaG2: Uint8Array, vkIc: Uint8Array[]): Promise<TransactionSignature>;
    /**
     * Deposit funds into the shielded pool
     */
    deposit(poolConfig: PublicKey, mint: PublicKey, amount: bigint | BN, commitment: Uint8Array, proofData: Uint8Array, encryptedNote?: Uint8Array | null): Promise<{
        signature: TransactionSignature;
        leafIndex: number;
    }>;
    /**
     * Withdraw funds from the shielded pool
     */
    withdraw(poolConfig: PublicKey, mint: PublicKey, recipient: PublicKey, amount: bigint | BN, merkleRoot: Uint8Array, nullifierHash: Uint8Array, proofData: Uint8Array, relayerFee?: bigint | BN): Promise<{
        signature: TransactionSignature;
    }>;
    /**
     * Fetch pool configuration
     */
    fetchPoolConfig(poolConfig: PublicKey): Promise<any>;
    /**
     * Fetch Merkle tree state
     */
    fetchMerkleTree(merkleTree: PublicKey): Promise<any>;
    /**
     * Fetch asset vault
     */
    fetchAssetVault(assetVault: PublicKey): Promise<any>;
    /**
     * Check if nullifier has been spent
     */
    isNullifierSpent(poolConfig: PublicKey, nullifierHash: Uint8Array): Promise<boolean>;
}
/**
 * Create a PsolV2Client from IDL JSON
 */
export declare function createPsolClient(provider: AnchorProvider, idl: any, programId?: PublicKey): PsolV2Client;
//# sourceMappingURL=client.d.ts.map