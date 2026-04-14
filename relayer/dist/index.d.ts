/**
 * The White Protocol Relayer Service
 *
 * HTTP service that relays withdrawal transactions for users.
 * Users submit proofs to the relayer, which submits them on-chain
 * and collects a fee.
 *
 * @module relayer
 */
import "dotenv/config";
import { Keypair, PublicKey } from '@solana/web3.js';
/** Configuration interface */
interface RelayerConfig {
    /** Solana RPC endpoint */
    rpcEndpoint: string;
    /** Relayer wallet keypair */
    walletKeypair: Keypair;
    /** The White Protocol program ID */
    programId: PublicKey;
    /** Pool configuration account */
    poolConfig: PublicKey;
    /** Fee in basis points (1 bp = 0.01%) */
    feeBps: number;
    /** Minimum withdrawal amount */
    minWithdrawalAmount: bigint;
    /** Maximum withdrawal amount */
    maxWithdrawalAmount: bigint;
    /** Server port */
    port: number;
    /** Path to withdraw verification key JSON (snarkjs vkey) */
    withdrawVkPath: string;
    /** Path to circuits build directory */
    circuitsPath: string;
    /** Merkle tree depth */
    treeDepth: number;
}
/** Withdrawal request interface */
interface WithdrawRequest {
    /** 256-byte proof data (hex encoded) */
    proofData: string;
    /** Merkle root (hex encoded) */
    merkleRoot: string;
    /** Nullifier hash (hex encoded) */
    nullifierHash: string;
    /** Recipient public key (base58) */
    recipient: string;
    /** Withdrawal amount */
    amount: string;
    /** Asset ID (hex encoded) */
    assetId: string;
    /** Token mint (base58) */
    mint: string;
}
/** Withdrawal response interface */
interface WithdrawResponse {
    success: boolean;
    signature?: string;
    error?: string;
}
/** Relayer status interface */
interface RelayerStatus {
    active: boolean;
    feeBps: number;
    operator: string;
    totalTransactions: number;
    totalFeesEarned: string;
    supportedAssets: string[];
    proofVerificationEnabled: boolean;
}
/**
 * The White Protocol Relayer Service
 */
export declare class RelayerService {
    private config;
    private connection;
    private provider;
    private program;
    private app;
    private totalTransactions;
    private totalFeesEarned;
    private supportedAssets;
    /** Verification key for withdraw circuit (snarkjs format) */
    private withdrawVk;
    /** In-flight nullifier hashes to prevent race-condition double spends */
    private pendingNullifiers;
    /** Circuit breaker for on-chain withdrawal submissions */
    private withdrawalBreaker;
    /** Nullifier cache to avoid repeated RPC checks */
    private nullifierCache;
    /** Service start timestamp for uptime calculation */
    private startTime;
    constructor(config: RelayerConfig);
    /**
     * Load persisted relayer state
     */
    private loadState;
    /**
     * Persist relayer state to disk
     */
    private persistState;
    /**
     * Load withdraw verification key from file
     * Fails fast if the key is not available
     */
    private loadWithdrawVerificationKey;
    /**
     * Setup Express middleware
     */
    private setupMiddleware;
    /**
     * Setup API routes
     */
    private setupRoutes;
    /**
     * Get relayer status
     */
    getStatus(): Promise<RelayerStatus>;
    /**
     * Calculate relayer fee
     */
    calculateFee(amount: bigint): bigint;
    /**
     * Process a withdrawal request
     */
    processWithdrawal(request: WithdrawRequest): Promise<WithdrawResponse>;
    /**
     * Locally verify a withdraw proof using snarkjs before submitting on-chain.
     *
     * This mirrors WithdrawPublicInputs::to_field_elements in the on-chain program
     * and the serializeProof layout in sdk/src/proof/prover.ts.
     */
    private verifyWithdrawProofLocally;
    /**
     * Validate withdrawal request format
     */
    private validateWithdrawRequest;
    /**
     * Check if nullifier has been spent on-chain
     */
    private checkNullifierSpent;
    /**
     * Submit withdrawal transaction with circuit breaker and retry logic
     */
    private submitWithdrawalWithRetry;
    /**
     * Submit withdrawal transaction
     */
    private submitWithdrawal;
    /**
     * Register asset as supported
     */
    addSupportedAsset(assetId: string): void;
    /**
     * Remove asset from supported list
     */
    removeSupportedAsset(assetId: string): void;
    /**
     * Start the relayer service
     */
    start(): Promise<void>;
}
/**
 * Create a new relayer service instance
 */
export declare function createRelayer(config: RelayerConfig): RelayerService;
/**
 * Example usage / entry point
 */
export declare function main(): Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map