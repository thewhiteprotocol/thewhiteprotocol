/**
 * The White Protocol SDK Client
 *
 * Simplified client for interacting with the The White Protocol MASP protocol
 */
import { AnchorProvider, Program, BN } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey, TransactionSignature } from '@solana/web3.js';
import { ProofType } from './types';
/** Default program ID */
/** Supported LST mints for Yield Mode */
export declare const SUPPORTED_LST_MINTS: {
    JitoSOL: PublicKey;
    mSOL: PublicKey;
};
/**
 * Options for creating a WhiteProtocolClient
 */
export interface WhiteProtocolClientOptions {
    provider?: AnchorProvider;
    connection?: Connection;
    wallet?: Keypair;
    programId?: PublicKey;
    idl?: any;
}
/**
 * Main client for interacting with the The White Protocol MASP protocol
 */
export declare class WhiteProtocolClient {
    readonly program: Program;
    readonly provider: AnchorProvider;
    readonly programId: PublicKey;
    constructor(options: WhiteProtocolClientOptions);
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
    withdraw(poolConfig: PublicKey, mint: PublicKey, recipient: PublicKey, amount: bigint | BN, merkleRoot: Uint8Array, nullifierHash: Uint8Array, proofData: Uint8Array, relayerFee?: bigint | BN): Promise<{
        signature: TransactionSignature;
    }>;
    /**
     * Stealth withdrawal — same as withdraw but emits an ephemeral pubkey on-chain
     * so the recipient can scan for and derive the stealth private key.
     */
    withdrawStealth(poolConfig: PublicKey, mint: PublicKey, recipient: PublicKey, amount: bigint | BN, merkleRoot: Uint8Array, nullifierHash: Uint8Array, proofData: Uint8Array, ephemeralPubkey: Uint8Array, relayerFee?: bigint | BN): Promise<{
        signature: TransactionSignature;
    }>;
    /**
     * Withdraw V2 (join-split with change)
     * Enables partial withdrawals with a change output
     *
     * @param poolConfig - Pool configuration account
     * @param mint - Token mint address
     * @param recipient - Recipient address for withdrawn funds
     * @param amount - Gross withdrawal amount (includes relayer fee)
     * @param merkleRoot - Merkle root for proof verification
     * @param nullifierHash0 - Primary nullifier hash
     * @param nullifierHash1 - Secondary nullifier hash (pass zeros if unused)
     * @param changeCommitment - Change output commitment
     * @param proofData - ZK proof bytes (256 bytes)
     * @param relayerFee - Fee for relayer service
     */
    withdrawV2(poolConfig: PublicKey, mint: PublicKey, recipient: PublicKey, amount: bigint | BN, merkleRoot: Uint8Array, nullifierHash0: Uint8Array, nullifierHash1: Uint8Array, changeCommitment: Uint8Array, proofData: Uint8Array, relayerFee?: bigint | BN): Promise<{
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
    /**
     * Deposit SOL with Yield Mode (swap to LST first)
     *
     * Flow:
     * 1. Swap SOL -> LST using Jupiter
     * 2. Deposit LST to pool (existing deposit flow)
     * 3. Store note metadata with principal SOL amount
     *
     * @param params - Deposit parameters with yield mode options
     * @returns Swap signature and deposit signature
     */
    depositYieldSol(params: {
        poolConfig: PublicKey;
        merkleTree: PublicKey;
        assetVault: PublicKey;
        mintLST: PublicKey;
        amountSolLamports: bigint;
        slippageBps?: number;
    }): Promise<{
        swapSig: string;
        depositSig: string;
        lstAmountDeposited: bigint;
        principalSol: bigint;
    }>;
    /**
     * Withdraw with Yield Mode (5% performance fee on positive yield)
     *
     * Flow:
     * 1. Fetch current LST -> SOL quote
     * 2. Calculate fee: max(0, current_value - principal) * 0.05
     * 3. Generate withdraw_v2 proof with relayer_fee
     * 4. Submit via relayer endpoint (relayer signs)
     *
     * @param params - Withdraw parameters with yield mode options
     * @returns Withdraw signature and optional swap signature
     */
    withdrawYieldV2(params: {
        poolConfig: PublicKey;
        merkleTree: PublicKey;
        assetVault: PublicKey;
        mintLST: PublicKey;
        recipient: PublicKey;
        amountLstAtomic: bigint;
        principalSolLamports: bigint;
        swapToSol?: boolean;
        slippageBps?: number;
    }): Promise<{
        withdrawSig: string;
        lstAmount: bigint;
        feeSol: bigint;
        feeLst: bigint;
        swapSig?: string;
    }>;
}
/**
 * Create a WhiteProtocolClient from IDL JSON
 */
export declare function createWhiteProtocolClient(provider: AnchorProvider, idl: any, programId?: PublicKey): WhiteProtocolClient;
//# sourceMappingURL=client.d.ts.map