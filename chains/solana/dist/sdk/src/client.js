"use strict";
/**
 * pSOL v2 SDK Client
 *
 * Simplified client for interacting with the pSOL v2 MASP protocol
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PsolV2Client = void 0;
exports.createPsolClient = createPsolClient;
const anchor_1 = require("@coral-xyz/anchor");
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const types_1 = require("./types");
const pda_1 = require("./pda");
/**
 * Main client for interacting with the pSOL v2 MASP protocol
 */
class PsolV2Client {
    constructor(options) {
        this.programId = options.programId ?? pda_1.PROGRAM_ID;
        if (options.provider) {
            this.provider = options.provider;
        }
        else if (options.connection && options.wallet) {
            const wallet = {
                publicKey: options.wallet.publicKey,
                signTransaction: async (tx) => {
                    tx.sign(options.wallet);
                    return tx;
                },
                signAllTransactions: async (txs) => {
                    txs.forEach((tx) => tx.sign(options.wallet));
                    return txs;
                },
            };
            this.provider = new anchor_1.AnchorProvider(options.connection, wallet, {
                commitment: 'confirmed',
            });
        }
        else {
            throw new Error('Either provider or connection+wallet must be provided');
        }
        if (!options.idl) {
            throw new Error('IDL must be provided');
        }
        this.program = new anchor_1.Program(options.idl, this.provider);
    }
    /**
     * Get authority public key
     */
    get authority() {
        return this.provider.publicKey;
    }
    // ============================================
    // Pool Administration
    // ============================================
    /**
     * Initialize a new MASP pool
     */
    async initializePool(treeDepth, rootHistorySize) {
        const authority = this.authority;
        const [poolConfig] = (0, pda_1.findPoolConfigPda)(this.programId, authority);
        const [merkleTree] = (0, pda_1.findMerkleTreePda)(this.programId, poolConfig);
        const tx = await this.program.methods
            .initializePoolV2(treeDepth, rootHistorySize)
            .accounts({
            authority,
            poolConfig,
            merkleTree,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return {
            signature: tx,
            poolConfig,
            merkleTree,
        };
    }
    /**
     * Initialize pool registries (relayer registry, compliance config)
     */
    async initializePoolRegistries(poolConfig) {
        const authority = this.authority;
        const [relayerRegistry] = (0, pda_1.findRelayerRegistryPda)(this.programId, poolConfig);
        const [complianceConfig] = (0, pda_1.findComplianceConfigPda)(this.programId, poolConfig);
        return await this.program.methods
            .initializePoolRegistries()
            .accounts({
            authority,
            poolConfig,
            relayerRegistry,
            complianceConfig,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
    }
    /**
     * Register an asset (SPL token) in the pool
     */
    async registerAsset(poolConfig, mint) {
        const authority = this.authority;
        const assetId = (0, pda_1.computeAssetId)(mint);
        const [assetVault] = (0, pda_1.findAssetVaultPda)(this.programId, poolConfig, assetId);
        // Vault token account PDA
        const [vaultTokenAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault_token'), assetVault.toBuffer()], this.programId);
        return await this.program.methods
            .registerAsset(Array.from(assetId))
            .accounts({
            authority,
            poolConfig,
            mint,
            assetVault,
            vaultTokenAccount,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
    }
    /**
     * Set verification key for a proof type
     */
    async setVerificationKey(poolConfig, proofType, vkAlphaG1, vkBetaG2, vkGammaG2, vkDeltaG2, vkIc) {
        const authority = this.authority;
        const [vkAccount] = (0, pda_1.findVerificationKeyPda)(this.programId, poolConfig, proofType);
        return await this.program.methods
            .setVerificationKeyV2(proofType, Array.from(vkAlphaG1), Array.from(vkBetaG2), Array.from(vkGammaG2), Array.from(vkDeltaG2), vkIc.map((ic) => Array.from(ic)))
            .accounts({
            authority,
            poolConfig,
            vkAccount,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
    }
    // ============================================
    // Deposits & Withdrawals
    // ============================================
    /**
     * Deposit funds into the shielded pool
     */
    async deposit(poolConfig, mint, amount, commitment, proofData, encryptedNote) {
        const depositor = this.authority;
        const assetId = (0, pda_1.computeAssetId)(mint);
        const [merkleTree] = (0, pda_1.findMerkleTreePda)(this.programId, poolConfig);
        const [assetVault] = (0, pda_1.findAssetVaultPda)(this.programId, poolConfig, assetId);
        const [vaultTokenAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault_token'), assetVault.toBuffer()], this.programId);
        const [depositVk] = (0, pda_1.findVerificationKeyPda)(this.programId, poolConfig, types_1.ProofType.Deposit);
        const userTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, depositor);
        const tx = await this.program.methods
            .depositMasp((0, types_1.toBN)(amount), Array.from(commitment), Array.from(assetId), Array.from(proofData), encryptedNote ? Array.from(encryptedNote) : null)
            .accounts({
            depositor,
            poolConfig,
            authority: depositor,
            merkleTree,
            assetVault,
            vaultTokenAccount,
            userTokenAccount,
            mint,
            depositVk,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return {
            signature: tx,
            leafIndex: 0, // TODO: Parse from logs
        };
    }
    /**
     * Withdraw funds from the shielded pool
     */
    async withdraw(poolConfig, mint, recipient, amount, merkleRoot, nullifierHash, proofData, relayerFee) {
        const relayer = this.authority;
        const assetId = (0, pda_1.computeAssetId)(mint);
        const [merkleTree] = (0, pda_1.findMerkleTreePda)(this.programId, poolConfig);
        const [assetVault] = (0, pda_1.findAssetVaultPda)(this.programId, poolConfig, assetId);
        const [vaultTokenAccount] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('vault_token'), assetVault.toBuffer()], this.programId);
        const [withdrawVk] = (0, pda_1.findVerificationKeyPda)(this.programId, poolConfig, types_1.ProofType.Withdraw);
        const [spentNullifier] = (0, pda_1.findSpentNullifierPda)(this.programId, poolConfig, nullifierHash);
        const [relayerRegistry] = (0, pda_1.findRelayerRegistryPda)(this.programId, poolConfig);
        const recipientTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, recipient);
        const relayerTokenAccount = (0, spl_token_1.getAssociatedTokenAddressSync)(mint, relayer);
        const tx = await this.program.methods
            .withdrawMasp(Array.from(proofData), Array.from(merkleRoot), Array.from(nullifierHash), recipient, (0, types_1.toBN)(amount), Array.from(assetId), (0, types_1.toBN)(relayerFee ?? 0n))
            .accounts({
            relayer,
            poolConfig,
            merkleTree,
            vkAccount: withdrawVk,
            assetVault,
            vaultTokenAccount,
            recipientTokenAccount,
            relayerTokenAccount,
            spentNullifier,
            relayerRegistry,
            relayerNode: null,
            tokenProgram: spl_token_1.TOKEN_PROGRAM_ID,
            systemProgram: web3_js_1.SystemProgram.programId,
        })
            .rpc();
        return { signature: tx };
    }
    // ============================================
    // Account Fetchers
    // ============================================
    /**
     * Fetch pool configuration
     */
    async fetchPoolConfig(poolConfig) {
        return await this.program.account.poolConfigV2.fetch(poolConfig);
    }
    /**
     * Fetch Merkle tree state
     */
    async fetchMerkleTree(merkleTree) {
        return await this.program.account.merkleTreeV2.fetch(merkleTree);
    }
    /**
     * Fetch asset vault
     */
    async fetchAssetVault(assetVault) {
        return await this.program.account.assetVault.fetch(assetVault);
    }
    /**
     * Check if nullifier has been spent
     */
    async isNullifierSpent(poolConfig, nullifierHash) {
        const [spentNullifier] = (0, pda_1.findSpentNullifierPda)(this.programId, poolConfig, nullifierHash);
        try {
            await this.program.account.spentNullifierV2.fetch(spentNullifier);
            return true;
        }
        catch {
            return false;
        }
    }
}
exports.PsolV2Client = PsolV2Client;
/**
 * Create a PsolV2Client from IDL JSON
 */
function createPsolClient(provider, idl, programId) {
    return new PsolV2Client({
        provider,
        idl,
        programId,
    });
}
