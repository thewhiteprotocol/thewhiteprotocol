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
    /** Path to withdraw_v2 verification key JSON (optional) */
    withdrawV2VkPath?: string;
    /** Path to circuits build directory */
    circuitsPath: string;
    /** Merkle tree depth */
    treeDepth: number;
    /** Base RPC endpoint */
    baseRpcUrl?: string;
    /** Base protocol contract address */
    baseProtocolAddress?: string;
    /** Base deployer private key */
    baseDeployerPrivateKey?: string;
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
    /** Token mint (base58 for Solana, address for Base) */
    mint: string;
    /** Target chain */
    chain?: 'solana' | 'base';
    /** Optional ephemeral pubkey for stealth withdrawals (64 hex chars = 32 bytes) */
    ephemeralPubkey?: string;
    /** Withdrawal version: v1 = standard, v2 = partial with change output */
    version?: 'v1' | 'v2';
    /** Change commitment for v2 partial withdrawals (hex encoded, 64 chars) */
    changeCommitment?: string;
    /** Secondary nullifier hash for v2 (hex encoded, 64 chars, defaults to zeros) */
    nullifierHash1?: string;
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
    private withdrawV2Vk;
    /** In-flight nullifier hashes to prevent race-condition double spends */
    private pendingNullifiers;
    /** Circuit breaker for on-chain withdrawal submissions */
    private withdrawalBreaker;
    /** Nullifier cache to avoid repeated RPC checks */
    private nullifierCache;
    /** Service start timestamp for uptime calculation */
    private startTime;
    /** Base chain adapter */
    private baseAdapter?;
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
     * Load withdraw_v2 verification key (optional — logs warning if missing)
     */
    private loadWithdrawV2VerificationKey;
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
     * Process a Solana withdrawal request
     */
    private processSolanaWithdrawal;
    /**
     * Process a Solana withdraw_v2 request (partial/full withdrawal with change output)
     */
    private processSolanaWithdrawalV2;
    /**
     * Process a Base withdrawal request
     */
    private processBaseWithdrawal;
    /**
     * Locally verify a withdraw proof using snarkjs before submitting on-chain.
     *
     * This mirrors WithdrawPublicInputs::to_field_elements in the on-chain program
     * and the serializeProof layout in sdk/src/proof/prover.ts.
     */
    private verifyWithdrawProofLocally;
    /**
     * Verify a withdraw_v2 proof locally before on-chain submission.
     * Accepts pre-constructed public signals (12 values) since v2 has more inputs.
     */
    private verifyWithdrawV2ProofLocally;
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
     * Submit withdraw_v2 transaction with circuit breaker and retry logic
     */
    private submitWithdrawalV2WithRetry;
    /**
     * Submit withdraw_v2 transaction on Solana
     */
    private submitWithdrawalV2;
    /**
     * Register asset as supported
     */
    addSupportedAsset(assetId: string): void;
    /**
     * Remove asset from supported list
     */
    removeSupportedAsset(assetId: string): void;
    /**
     * Run Base sequencer loop
     */
    private runBaseSequencer;
    /**
     * Start the relayer service
     */
    start(): Promise<void>;
}
/**
 * Create a new relayer service instance
 */
export declare function createRelayer(config: RelayerConfig): RelayerService;
export declare function main(): Promise<void>;
export {};
//# sourceMappingURL=index.d.ts.map