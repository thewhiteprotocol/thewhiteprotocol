"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayerService = void 0;
exports.createRelayer = createRelayer;
exports.main = main;
/**
 * The White Protocol Relayer Service
 *
 * HTTP service that relays withdrawal transactions for users.
 * Users submit proofs to the relayer, which submits them on-chain
 * and collects a fee.
 *
 * @module relayer
 */
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const api_extensions_1 = require("./api-extensions");
const fs = __importStar(require("fs"));
const snarkjs = __importStar(require("snarkjs"));
const logger_1 = require("./logger");
const base_1 = require("./chains/base");
const state_store_1 = require("./state-store");
const circuit_breaker_1 = require("./circuit-breaker");
const retry_1 = require("./retry");
const nullifier_cache_1 = require("./cache/nullifier-cache");
const metrics_1 = require("./metrics");
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const spl_token_1 = require("@solana/spl-token");
// =============================================================================
// CONSTANTS
// =============================================================================
/** BN254 scalar field order (same curve as used in circuits) */
const BN254_FIELD_ORDER = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
/** Maximum retry attempts for transaction submission */
const MAX_RETRY_ATTEMPTS = 3;
/** Base delay for exponential backoff (ms) */
const BASE_RETRY_DELAY_MS = 1000;
// =============================================================================
// RELAYER SERVICE
// =============================================================================
/**
 * The White Protocol Relayer Service
 */
class RelayerService {
    config;
    connection;
    provider;
    program;
    app;
    totalTransactions = 0;
    totalFeesEarned = BigInt(0);
    supportedAssets = new Set();
    /** Verification key for withdraw circuit (snarkjs format) */
    withdrawVk;
    /** In-flight nullifier hashes to prevent race-condition double spends */
    pendingNullifiers = new Set();
    /** Circuit breaker for on-chain withdrawal submissions */
    withdrawalBreaker = new circuit_breaker_1.CircuitBreaker('withdrawal', 5, 2, 30000);
    /** Nullifier cache to avoid repeated RPC checks */
    nullifierCache = new nullifier_cache_1.NullifierCache();
    /** Service start timestamp for uptime calculation */
    startTime = Date.now();
    /** Base chain adapter */
    baseAdapter;
    constructor(config) {
        this.config = config;
        this.connection = new web3_js_1.Connection(config.rpcEndpoint, 'confirmed');
        // Load withdraw verification key at startup (fail fast if missing)
        this.loadWithdrawVerificationKey();
        // Restore persisted state
        this.loadState();
        // Setup Anchor provider
        const wallet = {
            publicKey: config.walletKeypair.publicKey,
            signTransaction: async (tx) => {
                tx.sign(config.walletKeypair);
                return tx;
            },
            signAllTransactions: async (txs) => {
                txs.forEach(tx => tx.sign(config.walletKeypair));
                return txs;
            },
        };
        this.provider = new anchor_1.AnchorProvider(this.connection, wallet, {
            commitment: 'confirmed',
        });
        // Initialize Anchor program
        // Note: IDL is loaded dynamically - in production, embed the IDL
        this.program = null; // Will be initialized in start()
        // Setup Base adapter if configured
        if (config.baseDeployerPrivateKey) {
            this.baseAdapter = new base_1.BaseAdapter({
                rpcEndpoint: config.baseRpcUrl || 'https://sepolia.base.org',
                contractAddress: (config.baseProtocolAddress || '0xCE959493cf6F15314b4B9eEbb28369716341e7FE'),
                privateKey: config.baseDeployerPrivateKey,
            });
        }
        // Setup Express app
        this.app = (0, express_1.default)();
        this.setupMiddleware();
        this.setupRoutes();
    }
    /**
     * Load persisted relayer state
     */
    loadState() {
        const state = (0, state_store_1.loadRelayerState)();
        if (state) {
            this.totalTransactions = state.totalTransactions || 0;
            this.totalFeesEarned = BigInt(state.totalFeesEarned || '0');
            this.supportedAssets = new Set(state.supportedAssets || []);
            logger_1.logger.info('Relayer state restored from disk', {
                totalTransactions: this.totalTransactions,
                totalFeesEarned: this.totalFeesEarned.toString(),
            });
        }
    }
    /**
     * Persist relayer state to disk
     */
    persistState() {
        (0, state_store_1.saveRelayerState)({
            totalTransactions: this.totalTransactions,
            totalFeesEarned: this.totalFeesEarned.toString(),
            supportedAssets: Array.from(this.supportedAssets),
        });
    }
    /**
     * Load withdraw verification key from file
     * Fails fast if the key is not available
     */
    loadWithdrawVerificationKey() {
        try {
            logger_1.logger.info('Loading withdraw verification key', { path: this.config.withdrawVkPath });
            const vkeyJson = fs.readFileSync(this.config.withdrawVkPath, 'utf8');
            this.withdrawVk = JSON.parse(vkeyJson);
            // Basic validation of vkey structure
            if (!this.withdrawVk.protocol || !this.withdrawVk.curve) {
                throw new Error('Invalid verification key format: missing protocol or curve');
            }
            if (!this.withdrawVk.vk_alpha_1 || !this.withdrawVk.vk_beta_2) {
                throw new Error('Invalid verification key format: missing vk_alpha_1 or vk_beta_2');
            }
            logger_1.logger.info('Withdraw verification key loaded successfully', {
                protocol: this.withdrawVk.protocol,
                curve: this.withdrawVk.curve,
                icPoints: this.withdrawVk.IC?.length || 0,
            });
        }
        catch (err) {
            logger_1.logger.error('Failed to load withdraw verification key', { path: this.config.withdrawVkPath, error: String(err) });
            throw new Error('Withdraw verification key not available for relayer');
        }
    }
    /**
     * Setup Express middleware
     */
    setupMiddleware() {
        // Security headers
        this.app.use((0, helmet_1.default)());
        // CORS — never default to wildcard in production
        const corsOrigin = process.env.CORS_ORIGIN;
        this.app.use((0, cors_1.default)({
            origin: corsOrigin ? corsOrigin.split(',').map(s => s.trim()) : false,
            methods: ['GET', 'POST'],
        }));
        // JSON parsing
        this.app.use(express_1.default.json({ limit: '1mb' }));
        // Global backstop limiter (per IP, high cap, protects against total flood)
        const globalLimiter = (0, express_rate_limit_1.default)({
            windowMs: 60 * 1000, // 1 minute
            max: 500, // 500 requests/minute per IP
            message: { error: 'Service temporarily unavailable' },
        });
        // Per-key limiter (recipient for /withdraw, IP otherwise)
        const perKeyLimiter = (0, express_rate_limit_1.default)({
            windowMs: 60 * 1000, // 1 minute
            max: 30, // 30 requests per minute per key
            message: { error: 'Too many requests, please slow down' },
            keyGenerator: (req) => {
                // For withdraw we rate-limit by recipient, otherwise by IP
                if (req.method === 'POST' && req.path === '/withdraw') {
                    const body = req.body;
                    if (body && typeof body.recipient === 'string' && body.recipient.length > 0) {
                        return `recipient:${body.recipient}`;
                    }
                }
                // Fallback: per-IP limiting
                return req.ip || 'unknown';
            },
        });
        // Apply both: global then per-key
        this.app.use(globalLimiter);
        this.app.use(perKeyLimiter);
        // Request logging and metrics
        this.app.use((req, res, next) => {
            logger_1.logger.info('Incoming request', { method: req.method, path: req.path, ip: req.ip });
            metrics_1.metrics.recordRequest(req.path);
            const start = Date.now();
            res.on('finish', () => {
                metrics_1.metrics.recordResponseTime(Date.now() - start);
            });
            next();
        });
    }
    /**
     * Setup API routes
     */
    setupRoutes() {
        // Health check
        this.app.get('/health', (req, res) => {
            const mem = process.memoryUsage();
            res.json({
                status: 'ok',
                timestamp: Date.now(),
                uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
                proofVerificationEnabled: !!this.withdrawVk,
                pendingNullifiers: this.pendingNullifiers.size,
                circuitBreaker: this.withdrawalBreaker.getStatus(),
                memoryMb: {
                    rss: Math.round(mem.rss / 1024 / 1024),
                    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                },
            });
        });
        // Metrics endpoint
        this.app.get('/metrics', (req, res) => {
            res.json(metrics_1.metrics.getSnapshot());
        });
        // Relayer status
        this.app.get('/status', async (req, res) => {
            try {
                const status = await this.getStatus();
                res.json(status);
            }
            catch (error) {
                res.status(500).json({ error: error.message });
            }
        });
        // Fee quote
        this.app.get('/quote', (req, res) => {
            const amount = BigInt(req.query.amount || '0');
            const fee = this.calculateFee(amount);
            res.json({
                amount: amount.toString(),
                fee: fee.toString(),
                feeBps: this.config.feeBps,
                netAmount: (amount - fee).toString(),
            });
        });
        // Submit withdrawal
        this.app.post('/withdraw', async (req, res) => {
            try {
                const result = await this.processWithdrawal(req.body);
                res.json(result);
            }
            catch (error) {
                logger_1.logger.error('Withdrawal request failed', { error: error.message });
                metrics_1.metrics.recordWithdrawal(false);
                res.status(400).json({
                    success: false,
                    error: error.message,
                });
            }
        });
        // Supported assets
        this.app.get('/assets', async (req, res) => {
            res.json({
                assets: Array.from(this.supportedAssets),
            });
        });
        // Error handler
        this.app.use((err, req, res, next) => {
            logger_1.logger.error('Unhandled error', { error: err.message, stack: err.stack });
            res.status(500).json({ error: 'Internal server error' });
        });
    }
    /**
     * Get relayer status
     */
    async getStatus() {
        return {
            active: true,
            feeBps: this.config.feeBps,
            operator: this.config.walletKeypair.publicKey.toBase58(),
            totalTransactions: this.totalTransactions,
            totalFeesEarned: this.totalFeesEarned.toString(),
            supportedAssets: Array.from(this.supportedAssets),
            proofVerificationEnabled: !!this.withdrawVk,
        };
    }
    /**
     * Calculate relayer fee
     */
    calculateFee(amount) {
        return (amount * BigInt(this.config.feeBps)) / BigInt(10000);
    }
    /**
     * Process a withdrawal request
     */
    async processWithdrawal(request) {
        // 1. Validate request format
        this.validateWithdrawRequest(request);
        if (request.chain === 'base') {
            return this.processBaseWithdrawal(request);
        }
        return this.processSolanaWithdrawal(request);
    }
    /**
     * Process a Solana withdrawal request
     */
    async processSolanaWithdrawal(request) {
        const startTime = Date.now();
        const amount = BigInt(request.amount);
        const fee = this.calculateFee(amount);
        // 2. Verify amount bounds
        if (amount < this.config.minWithdrawalAmount) {
            throw new Error(`Amount below minimum: ${this.config.minWithdrawalAmount}`);
        }
        if (amount > this.config.maxWithdrawalAmount) {
            throw new Error(`Amount above maximum: ${this.config.maxWithdrawalAmount}`);
        }
        // 3. Check asset is supported BEFORE expensive proof verification
        if (this.supportedAssets.size > 0 && !this.supportedAssets.has(request.assetId)) {
            throw new Error(`Asset ${request.assetId} not supported by this relayer`);
        }
        // 4. Decode inputs
        const proofData = hexToBytes(request.proofData);
        const merkleRoot = hexToBytes(request.merkleRoot);
        const nullifierHash = hexToBytes(request.nullifierHash);
        const assetId = hexToBytes(request.assetId);
        const recipient = new web3_js_1.PublicKey(request.recipient);
        const mint = new web3_js_1.PublicKey(request.mint);
        // 5. Locally verify the ZK proof before touching chain state
        const proofVerifyStart = Date.now();
        const isProofValid = await this.verifyWithdrawProofLocally({
            proofData,
            merkleRoot,
            nullifierHash,
            assetId,
            recipient,
            amount,
            relayer: this.config.walletKeypair.publicKey,
            relayerFee: fee,
            publicDataHash: undefined, // If you add encrypted metadata later, pass its hash here
        });
        const proofVerifyTime = Date.now() - proofVerifyStart;
        logger_1.logger.info('Proof verification completed', { durationMs: proofVerifyTime, valid: isProofValid });
        if (!isProofValid) {
            throw new Error('Invalid withdrawal proof (local verification failed)');
        }
        const nullifierKey = bytesToHex(nullifierHash);
        // In-flight deduplication: prevent concurrent processing of the same nullifier
        if (this.pendingNullifiers.has(nullifierKey)) {
            throw new Error('Nullifier already being processed');
        }
        this.pendingNullifiers.add(nullifierKey);
        try {
            // 6. Check nullifier hasn't been spent (with timeout)
            const isSpent = await withTimeout(this.checkNullifierSpent(nullifierHash), 15000, 'Nullifier check timed out');
            if (isSpent) {
                throw new Error('Nullifier already spent');
            }
            // 7. Build and submit transaction with retry logic (with timeout)
            const signature = await withTimeout(this.submitWithdrawalWithRetry({
                proofData,
                merkleRoot,
                nullifierHash,
                recipient,
                amount,
                fee,
                assetId,
                mint,
            }), 90000, 'Transaction submission timed out');
            // 8. Update statistics and cache
            this.totalTransactions++;
            this.totalFeesEarned += fee;
            await this.nullifierCache.markNullifierUsed(this.config.poolConfig, nullifierHash);
            this.persistState();
            metrics_1.metrics.recordWithdrawal(true);
            const totalTime = Date.now() - startTime;
            logger_1.logger.info('Withdrawal processed successfully', {
                durationMs: totalTime,
                signature,
                recipient: recipient.toBase58(),
                amount: amount.toString(),
                fee: fee.toString(),
            });
            return {
                success: true,
                signature,
            };
        }
        finally {
            this.pendingNullifiers.delete(nullifierKey);
        }
    }
    /**
     * Process a Base withdrawal request
     */
    async processBaseWithdrawal(request) {
        if (!this.baseAdapter) {
            throw new Error('Base adapter not initialized');
        }
        const startTime = Date.now();
        const amount = BigInt(request.amount);
        const fee = this.calculateFee(amount);
        // Verify amount bounds
        if (amount < this.config.minWithdrawalAmount) {
            throw new Error(`Amount below minimum: ${this.config.minWithdrawalAmount}`);
        }
        if (amount > this.config.maxWithdrawalAmount) {
            throw new Error(`Amount above maximum: ${this.config.maxWithdrawalAmount}`);
        }
        // Check asset is supported BEFORE expensive proof verification
        if (this.supportedAssets.size > 0 && !this.supportedAssets.has(request.assetId)) {
            throw new Error(`Asset ${request.assetId} not supported by this relayer`);
        }
        // Decode inputs
        const proofData = hexToBytes(request.proofData);
        const merkleRoot = hexToBytes(request.merkleRoot);
        const nullifierHash = hexToBytes(request.nullifierHash);
        const assetId = hexToBytes(request.assetId);
        const recipient = request.recipient;
        const tokenAddr = request.mint;
        // Locally verify the ZK proof before touching chain state
        const proofVerifyStart = Date.now();
        const isProofValid = await this.verifyWithdrawProofLocally({
            proofData,
            merkleRoot,
            nullifierHash,
            assetId,
            recipient,
            amount,
            relayer: this.baseAdapter.getAddress(),
            relayerFee: fee,
            publicDataHash: undefined,
        });
        const proofVerifyTime = Date.now() - proofVerifyStart;
        logger_1.logger.info('Proof verification completed', { durationMs: proofVerifyTime, valid: isProofValid });
        if (!isProofValid) {
            throw new Error('Invalid withdrawal proof (local verification failed)');
        }
        const nullifierKey = bytesToHex(nullifierHash);
        // In-flight deduplication: prevent concurrent processing of the same nullifier
        if (this.pendingNullifiers.has(nullifierKey)) {
            throw new Error('Nullifier already being processed');
        }
        this.pendingNullifiers.add(nullifierKey);
        try {
            // Check nullifier hasn't been spent (with timeout)
            const isSpent = await withTimeout(this.baseAdapter.isSpent(`0x${bytesToHex(nullifierHash)}`), 15000, 'Nullifier check timed out');
            if (isSpent) {
                throw new Error('Nullifier already spent');
            }
            // Submit transaction (with timeout)
            const signature = await withTimeout(this.baseAdapter.submitWithdrawal(`0x${request.proofData}`, `0x${request.nullifierHash}`, `0x${request.merkleRoot}`, recipient, tokenAddr, amount, fee), 90000, 'Transaction submission timed out');
            // Update statistics
            this.totalTransactions++;
            this.totalFeesEarned += fee;
            this.persistState();
            metrics_1.metrics.recordWithdrawal(true);
            const totalTime = Date.now() - startTime;
            logger_1.logger.info('Base withdrawal processed successfully', {
                durationMs: totalTime,
                signature,
                recipient,
                amount: amount.toString(),
                fee: fee.toString(),
            });
            return {
                success: true,
                signature,
            };
        }
        finally {
            this.pendingNullifiers.delete(nullifierKey);
        }
    }
    /**
     * Locally verify a withdraw proof using snarkjs before submitting on-chain.
     *
     * This mirrors WithdrawPublicInputs::to_field_elements in the on-chain program
     * and the serializeProof layout in sdk/src/proof/prover.ts.
     */
    async verifyWithdrawProofLocally(params) {
        if (!this.withdrawVk) {
            throw new Error('Withdraw verification key not loaded in relayer');
        }
        // Validate proof data length
        if (params.proofData.length !== 256) {
            logger_1.logger.error('Invalid proof data length', { expected: 256, actual: params.proofData.length });
            return false;
        }
        try {
            // Deserialize the proof
            const proof = deserializeGroth16Proof(params.proofData);
            // Convert inputs to field elements
            const merkleRootScalar = bytesToBigInt(params.merkleRoot);
            const nullifierHashScalar = bytesToBigInt(params.nullifierHash);
            const assetIdScalar = bytesToBigInt(params.assetId);
            const recipientScalar = typeof params.recipient === 'string' ? BigInt(params.recipient) : pubkeyToScalar(params.recipient);
            const relayerScalar = typeof params.relayer === 'string' ? BigInt(params.relayer) : pubkeyToScalar(params.relayer);
            const publicDataHashScalar = params.publicDataHash
                ? bytesToBigInt(params.publicDataHash)
                : 0n;
            // Validate all field elements are within BN254 order
            validateFieldElement(merkleRootScalar, 'merkleRoot');
            validateFieldElement(nullifierHashScalar, 'nullifierHash');
            validateFieldElement(assetIdScalar, 'assetId');
            validateFieldElement(recipientScalar, 'recipient');
            validateFieldElement(relayerScalar, 'relayer');
            validateFieldElement(publicDataHashScalar, 'publicDataHash');
            validateFieldElement(params.amount, 'amount');
            validateFieldElement(params.relayerFee, 'relayerFee');
            // Public signals order must match circuit's public inputs:
            // merkle_root, nullifier_hash, asset_id, recipient, amount,
            // relayer, relayer_fee, public_data_hash
            const publicSignals = [
                merkleRootScalar.toString(),
                nullifierHashScalar.toString(),
                assetIdScalar.toString(),
                recipientScalar.toString(),
                params.amount.toString(),
                relayerScalar.toString(),
                params.relayerFee.toString(),
                publicDataHashScalar.toString(),
            ];
            logger_1.logger.info('Verifying proof with public signals', {
                merkleRoot: merkleRootScalar.toString().slice(0, 20) + '...',
                nullifierHash: nullifierHashScalar.toString().slice(0, 20) + '...',
                amount: params.amount.toString(),
                relayerFee: params.relayerFee.toString(),
            });
            const result = await snarkjs.groth16.verify(this.withdrawVk, publicSignals, proof);
            if (typeof result !== 'boolean') {
                throw new Error('Unexpected snarkjs verify() result type');
            }
            return result;
        }
        catch (err) {
            logger_1.logger.error('Proof verification error', { error: String(err) });
            return false;
        }
    }
    /**
     * Validate withdrawal request format
     */
    validateWithdrawRequest(request) {
        // Validate lengths and presence
        if (!request.proofData || request.proofData.length !== 512) {
            throw new Error('Invalid proof data length (must be 256 bytes hex)');
        }
        if (!request.merkleRoot || request.merkleRoot.length !== 64) {
            throw new Error('Invalid merkle root length');
        }
        if (!request.nullifierHash || request.nullifierHash.length !== 64) {
            throw new Error('Invalid nullifier hash length');
        }
        if (!request.recipient) {
            throw new Error('Missing recipient');
        }
        if (request.chain === 'base') {
            // Validate recipient is a valid Ethereum address
            if (!/^0x[a-fA-F0-9]{40}$/.test(request.recipient)) {
                throw new Error('Invalid recipient Ethereum address');
            }
            if (!request.mint || !/^0x[a-fA-F0-9]{40}$/.test(request.mint)) {
                throw new Error('Invalid token address');
            }
        }
        else {
            // Validate recipient is a valid Solana public key
            try {
                new web3_js_1.PublicKey(request.recipient);
            }
            catch {
                throw new Error('Invalid recipient public key');
            }
            if (!request.mint) {
                throw new Error('Missing mint');
            }
            // Validate mint is a valid Solana public key
            try {
                new web3_js_1.PublicKey(request.mint);
            }
            catch {
                throw new Error('Invalid mint public key');
            }
        }
        if (!request.amount || !/^\d+$/.test(request.amount) || request.amount.length > 30) {
            throw new Error('Invalid amount');
        }
        if (BigInt(request.amount) <= 0) {
            throw new Error('Amount must be greater than zero');
        }
        if (!request.assetId || request.assetId.length !== 64) {
            throw new Error('Invalid asset ID length');
        }
        // Validate hex strings are valid
        if (!/^[0-9a-fA-F]+$/.test(request.proofData)) {
            throw new Error('Invalid proof data: not valid hex');
        }
        if (!/^[0-9a-fA-F]+$/.test(request.merkleRoot)) {
            throw new Error('Invalid merkle root: not valid hex');
        }
        if (!/^[0-9a-fA-F]+$/.test(request.nullifierHash)) {
            throw new Error('Invalid nullifier hash: not valid hex');
        }
        if (!/^[0-9a-fA-F]+$/.test(request.assetId)) {
            throw new Error('Invalid asset ID: not valid hex');
        }
        // Prevent DoS via extremely long strings
        const maxFieldLength = 2048;
        for (const [key, value] of Object.entries(request)) {
            if (typeof value === 'string' && value.length > maxFieldLength) {
                throw new Error(`Field ${key} exceeds maximum length`);
            }
        }
    }
    /**
     * Check if nullifier has been spent on-chain
     */
    async checkNullifierSpent(nullifierHash) {
        const [nullifierPda] = web3_js_1.PublicKey.findProgramAddressSync([
            Buffer.from('nullifier_v2'),
            this.config.poolConfig.toBuffer(),
            Buffer.from(nullifierHash),
        ], this.config.programId);
        // Check local cache first
        const cached = await this.nullifierCache.isNullifierUsed(this.config.poolConfig, nullifierHash);
        if (cached) {
            return true;
        }
        try {
            const accountInfo = await (0, retry_1.withRetry)(() => this.connection.getAccountInfo(nullifierPda), { maxAttempts: 3, baseDelayMs: 500, nonRetryablePatterns: [] });
            // Account exists => nullifier is spent
            const isSpent = accountInfo !== null;
            if (isSpent) {
                await this.nullifierCache.markNullifierUsed(this.config.poolConfig, nullifierHash);
            }
            return isSpent;
        }
        catch (err) {
            // RPC/network error, do not silently treat as spent or unspent
            logger_1.logger.error('RPC error checking nullifier status', {
                nullifier: bytesToHex(nullifierHash),
                pda: nullifierPda.toBase58(),
                error: err instanceof Error ? err.message : String(err),
            });
            throw new Error('Failed to verify nullifier status - RPC error');
        }
    }
    /**
     * Submit withdrawal transaction with circuit breaker and retry logic
     */
    async submitWithdrawalWithRetry(params) {
        return this.withdrawalBreaker.execute(() => (0, retry_1.withRetry)(async () => {
            logger_1.logger.info('Submitting withdrawal transaction');
            const signature = await this.submitWithdrawal(params);
            return signature;
        }, {
            maxAttempts: MAX_RETRY_ATTEMPTS,
            baseDelayMs: BASE_RETRY_DELAY_MS,
            nonRetryablePatterns: [
                'nullifier already spent',
                'invalid proof',
                'insufficient funds',
                'account not found',
                'invalid signature',
                'simulation failed',
                'instruction error',
            ],
        }));
    }
    /**
     * Submit withdrawal transaction
     */
    async submitWithdrawal(params) {
        // Derive PDAs
        const [merkleTree] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('merkle_tree_v2'), this.config.poolConfig.toBuffer()], this.config.programId);
        const [assetVault] = web3_js_1.PublicKey.findProgramAddressSync([
            Buffer.from('vault_v2'),
            this.config.poolConfig.toBuffer(),
            Buffer.from(params.assetId),
        ], this.config.programId);
        const [vkAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vk_withdraw'), this.config.poolConfig.toBuffer()], this.config.programId);
        const [nullifierPda] = web3_js_1.PublicKey.findProgramAddressSync([
            Buffer.from('nullifier_v2'),
            this.config.poolConfig.toBuffer(),
            Buffer.from(params.nullifierHash),
        ], this.config.programId);
        const [relayerRegistry] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('relayer_registry'), this.config.poolConfig.toBuffer()], this.config.programId);
        const [relayerNode] = web3_js_1.PublicKey.findProgramAddressSync([
            Buffer.from('relayer'),
            relayerRegistry.toBuffer(),
            this.config.walletKeypair.publicKey.toBuffer(),
        ], this.config.programId);
        // Get token accounts
        const vaultTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(params.mint, assetVault, true);
        const recipientTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(params.mint, params.recipient);
        const relayerTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(params.mint, this.config.walletKeypair.publicKey);
        // Build instruction - FIXED: correct args and snake_case accounts
        const ix = await this.program.methods
            .withdrawMasp(Buffer.from(params.proofData), Array.from(params.merkleRoot), Array.from(params.nullifierHash), params.recipient, new anchor_1.BN(params.amount.toString()), Array.from(params.assetId), new anchor_1.BN(params.fee.toString()))
            .accountsStrict({
            relayer: this.config.walletKeypair.publicKey,
            pool_config: this.config.poolConfig,
            merkle_tree: merkleTree,
            vk_account: vkAccount,
            asset_vault: assetVault,
            vault_token_account: vaultTokenAccount,
            recipient_token_account: recipientTokenAccount,
            relayer_token_account: relayerTokenAccount,
            spent_nullifier: nullifierPda,
            relayer_registry: relayerRegistry,
            relayer_node: relayerNode,
            token_program: new web3_js_1.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
            system_program: new web3_js_1.PublicKey("11111111111111111111111111111111"),
        })
            .instruction();
        // Build and send transaction
        const { blockhash, lastValidBlockHeight } = await (0, retry_1.withRetry)(() => this.connection.getLatestBlockhash('confirmed'), { maxAttempts: 3, baseDelayMs: 500 });
        const tx = new web3_js_1.Transaction({ blockhash, lastValidBlockHeight }).add(ix);
        tx.feePayer = this.config.walletKeypair.publicKey;
        try {
            const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, tx, [this.config.walletKeypair], {
                commitment: 'confirmed',
                maxRetries: 2,
            });
            return signature;
        }
        catch (err) {
            if (err instanceof web3_js_1.TransactionExpiredBlockheightExceededError) {
                logger_1.logger.warn('Transaction expired due to blockheight exceeded');
            }
            throw err;
        }
    }
    /**
     * Register asset as supported
     */
    addSupportedAsset(assetId) {
        // Validate asset ID format
        if (!/^[0-9a-fA-F]{64}$/.test(assetId)) {
            throw new Error('Invalid asset ID format: must be 64 hex characters');
        }
        this.supportedAssets.add(assetId.toLowerCase());
        this.persistState();
        logger_1.logger.info('Registered supported asset', { assetId });
    }
    /**
     * Remove asset from supported list
     */
    removeSupportedAsset(assetId) {
        this.supportedAssets.delete(assetId.toLowerCase());
        this.persistState();
        logger_1.logger.info('Removed supported asset', { assetId });
    }
    /**
     * Run Base sequencer loop
     */
    runBaseSequencer() {
        const loop = async () => {
            while (true) {
                try {
                    if (this.baseAdapter) {
                        const pending = this.baseAdapter.getPendingCount();
                        if (pending > 0) {
                            logger_1.logger.info('Base settlement needed', { pendingDeposits: pending });
                        }
                    }
                }
                catch (err) {
                    logger_1.logger.error('Base sequencer error', { error: String(err) });
                }
                await sleep(60000);
            }
        };
        loop();
    }
    /**
     * Start the relayer service
     */
    async start() {
        // Initialize API extensions for proof generation
        const apiExtensions = await (0, api_extensions_1.createApiExtensions)({
            circuitsPath: this.config.circuitsPath,
            rpcEndpoint: this.config.rpcEndpoint,
            poolConfig: this.config.poolConfig,
            programId: this.config.programId,
            treeDepth: this.config.treeDepth,
        });
        // Mount API extensions
        this.app.use("/api", apiExtensions.getRouter());
        this.app.listen(this.config.port, () => {
            logger_1.logger.info('The White Protocol Relayer Service Started', {
                port: this.config.port,
                operator: this.config.walletKeypair.publicKey.toBase58(),
                feeBps: this.config.feeBps,
                apiExtensions: true,
            });
        });
        if (this.baseAdapter) {
            this.runBaseSequencer();
        }
        // Graceful shutdown: persist state before exit
        const shutdown = (signal) => {
            logger_1.logger.info('Received shutdown signal, persisting state', { signal });
            this.persistState();
            process.exit(0);
        };
        process.once('SIGTERM', () => shutdown('SIGTERM'));
        process.once('SIGINT', () => shutdown('SIGINT'));
    }
}
exports.RelayerService = RelayerService;
// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================
/**
 * Convert hex string to Uint8Array
 */
function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}
/**
 * Convert Uint8Array to hex string
 */
function bytesToHex(bytes) {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
/**
 * Convert 32-byte big-endian array into a bigint.
 */
function bytesToBigInt(bytes) {
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result;
}
/**
 * Convert Solana PublicKey to scalar field element (BN254).
 * Mirrors pubkeyToScalar in the SDK.
 */
function pubkeyToScalar(pubkey) {
    const bytes = pubkey.toBytes();
    let result = 0n;
    for (let i = 0; i < bytes.length; i++) {
        result = (result << 8n) | BigInt(bytes[i]);
    }
    return result % BN254_FIELD_ORDER;
}
/**
 * Validate a field element is within BN254 order
 */
function validateFieldElement(value, name) {
    if (value < 0n) {
        throw new Error(`${name} is negative: ${value}`);
    }
    if (value >= BN254_FIELD_ORDER) {
        throw new Error(`${name} exceeds field order: ${value}`);
    }
}
/**
 * Deserialize Groth16 proof from 256-byte compressed format.
 * Inverse of sdk/src/proof/prover.ts::serializeProof.
 *
 * Layout:
 *   A: 0..32 (x), 32..64 (y)
 *   B: 64..96 (x0_1), 96..128 (x0_0), 128..160 (y1_1), 160..192 (y1_0)
 *   C: 192..224 (x), 224..256 (y)
 */
function deserializeGroth16Proof(proofData) {
    if (proofData.length !== 256) {
        throw new Error(`Invalid proof data length: expected 256 bytes, got ${proofData.length}`);
    }
    const slice = (start, end) => proofData.slice(start, end);
    const a0 = bytesToBigInt(slice(0, 32)).toString();
    const a1 = bytesToBigInt(slice(32, 64)).toString();
    // Note: see serializeProof for this swapped ordering
    const b01 = bytesToBigInt(slice(64, 96)).toString(); // pi_b[0][1]
    const b00 = bytesToBigInt(slice(96, 128)).toString(); // pi_b[0][0]
    const b11 = bytesToBigInt(slice(128, 160)).toString(); // pi_b[1][1]
    const b10 = bytesToBigInt(slice(160, 192)).toString(); // pi_b[1][0]
    const c0 = bytesToBigInt(slice(192, 224)).toString();
    const c1 = bytesToBigInt(slice(224, 256)).toString();
    const proof = {
        pi_a: [a0, a1, '1'],
        pi_b: [
            [b00, b01],
            [b10, b11],
            ['1', '0'],
        ],
        pi_c: [c0, c1, '1'],
        protocol: 'groth16',
        curve: 'bn128',
    };
    return proof;
}
/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Race a promise against a timeout
 */
function withTimeout(promise, ms, message) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
}
// =============================================================================
// EXPORTS
// =============================================================================
/**
 * Create a new relayer service instance
 */
function createRelayer(config) {
    return new RelayerService(config);
}
/**
 * Example usage / entry point
 */
async function main() {
    // Load configuration from environment
    const config = {
        rpcEndpoint: process.env.RPC_ENDPOINT || 'https://api.devnet.solana.com',
        walletKeypair: web3_js_1.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.RELAYER_KEYPAIR || '[]'))),
        programId: new web3_js_1.PublicKey(process.env.PROGRAM_ID || 'C9GAJTFVgijNzB4SWZeNKmzruzjzrZ4H6J1DpKha9GoW'),
        poolConfig: new web3_js_1.PublicKey(process.env.POOL_CONFIG || '11111111111111111111111111111111'),
        feeBps: parseInt(process.env.FEE_BPS || '50', 10),
        minWithdrawalAmount: BigInt(process.env.MIN_WITHDRAWAL || '1000000'),
        maxWithdrawalAmount: BigInt(process.env.MAX_WITHDRAWAL || '1000000000000'),
        port: parseInt(process.env.PORT || '3000', 10),
        withdrawVkPath: process.env.WITHDRAW_VK_PATH || './circuits/build/withdraw_vk.json',
        circuitsPath: process.env.CIRCUITS_PATH || "../circuits/build",
        treeDepth: parseInt(process.env.TREE_DEPTH || "20", 10),
        baseRpcUrl: process.env.BASE_RPC_URL || 'https://sepolia.base.org',
        baseProtocolAddress: process.env.BASE_PROTOCOL_ADDRESS || '0xCE959493cf6F15314b4B9eEbb28369716341e7FE',
        baseDeployerPrivateKey: process.env.BASE_DEPLOYER_PRIVATE_KEY,
    };
    const relayer = createRelayer(config);
    // Add supported assets if configured
    const supportedAssets = process.env.SUPPORTED_ASSETS?.split(',') || [];
    for (const asset of supportedAssets) {
        if (asset.trim()) {
            relayer.addSupportedAsset(asset.trim());
        }
    }
    await relayer.start();
}
// Run if executed directly
if (require.main === module) {
    main().catch(err => {
        logger_1.logger.error('Failed to start relayer', { error: String(err) });
        process.exit(1);
    });
}
