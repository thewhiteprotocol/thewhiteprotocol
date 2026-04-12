"use strict";
/**
 * Relayer Selection for pSOL v2 (CORRECTED)
 *
 * # Fix Applied
 *
 * Uses Anchor IDL decoder instead of manual byte slicing.
 * This prevents breakage when account layout changes.
 *
 * @module relayer/relayer-selector
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelayerSelector = void 0;
exports.createRelayerSelector = createRelayerSelector;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
/**
 * Relayer selector - finds and ranks relayers
 *
 * CORRECTED: Uses Anchor IDL decoder instead of manual byte slicing
 */
class RelayerSelector {
    constructor(config) {
        this.connection = config.connection;
        this.programId = config.programId;
        this.pool = config.pool;
        this.program = config.program || null;
    }
    /**
     * Load program with IDL if not already loaded
     */
    async ensureProgram() {
        if (this.program) {
            return this.program;
        }
        // Load IDL from chain or local file
        // This requires the IDL to be available
        throw new Error('Program not provided. Please load IDL and create Program instance, then pass to RelayerSelectorConfig');
    }
    /**
     * Get all active relayers for the pool (CORRECTED VERSION)
     *
     * FIXED: Uses Anchor account decoder instead of manual byte slicing
     */
    async getAllActiveRelayers() {
        try {
            const program = await this.ensureProgram();
            // Get relayer registry PDA
            const [registryPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('relayer_registry'), this.pool.toBuffer()], this.programId);
            // Fetch all RelayerNode accounts using Anchor
            // This uses the IDL to properly decode account data
            const relayerAccounts = await program.account.relayerNode.all([
                {
                    memcmp: {
                        offset: 8, // After discriminator
                        bytes: registryPda.toBase58(),
                    },
                },
            ]);
            const relayers = [];
            for (const account of relayerAccounts) {
                try {
                    // CORRECTED: Use decoded account data from Anchor
                    const data = account.account;
                    // Only include active relayers
                    if (!data.isActive) {
                        continue;
                    }
                    // Parse metadata URI to get endpoint (if present)
                    let endpoint;
                    if (data.metadataUri && data.metadataUri.length > 0) {
                        try {
                            // Fetch metadata JSON
                            const metadataResponse = await fetch(data.metadataUri);
                            if (metadataResponse.ok) {
                                const metadata = await metadataResponse.json();
                                endpoint = metadata.endpoint;
                            }
                        }
                        catch (err) {
                            console.warn(`Failed to fetch metadata for relayer ${data.operator.toBase58()}:`, err);
                        }
                    }
                    relayers.push({
                        address: account.publicKey,
                        operator: data.operator,
                        feeBps: data.feeBps,
                        isActive: data.isActive,
                        endpoint,
                        totalTransactions: data.totalTransactions || 0,
                        totalFeesCollected: BigInt(data.totalFeesCollected?.toString() || '0'),
                    });
                }
                catch (err) {
                    console.error('Failed to parse relayer account:', err);
                }
            }
            console.log(`Found ${relayers.length} active relayers`);
            return relayers;
        }
        catch (err) {
            console.error('Failed to fetch relayers:', err);
            return [];
        }
    }
    /**
     * Alternative: Fetch relayers without program instance
     *
     * This version manually decodes but uses the CORRECT layout.
     * Better than byte slicing at hard-coded offsets.
     */
    async getAllActiveRelayersManual() {
        try {
            // Get relayer registry PDA
            const [registryPda] = web3_js_1.PublicKey.findProgramAddressSync([Buffer.from('relayer_registry'), this.pool.toBuffer()], this.programId);
            // Fetch all RelayerNode accounts
            const accounts = await this.connection.getProgramAccounts(this.programId, {
                filters: [
                    {
                        memcmp: {
                            offset: 8,
                            bytes: registryPda.toBase58(),
                        },
                    },
                ],
            });
            const relayers = [];
            for (const account of accounts) {
                try {
                    const data = account.account.data;
                    // IMPROVED: Decode using known structure
                    // This is still brittle but better documented
                    //
                    // RelayerNode structure:
                    // - discriminator (8 bytes)
                    // - registry (32 bytes) - offset 8
                    // - operator (32 bytes) - offset 40
                    // - fee_bps (2 bytes, u16) - offset 72
                    // - is_active (1 byte, bool) - offset 74
                    // - metadata_uri (4 + N bytes, String)
                    // - stats...
                    if (data.length < 75) {
                        continue; // Invalid account
                    }
                    // Extract is_active first (cheapest check)
                    const isActive = data[74] === 1;
                    if (!isActive) {
                        continue;
                    }
                    // Extract operator (32 bytes at offset 40)
                    const operatorBytes = data.slice(40, 72);
                    const operator = new web3_js_1.PublicKey(operatorBytes);
                    // Extract fee_bps (u16 little-endian at offset 72)
                    const feeBps = data[72] | (data[73] << 8);
                    // Extract metadata_uri length (u32 at offset 75)
                    const metadataUriLen = data[75] |
                        (data[76] << 8) |
                        (data[77] << 16) |
                        (data[78] << 24);
                    let metadataUri = '';
                    if (metadataUriLen > 0 && metadataUriLen < 256) {
                        const uriBytes = data.slice(79, 79 + metadataUriLen);
                        metadataUri = Buffer.from(uriBytes).toString('utf8');
                    }
                    // Parse endpoint from metadata if present
                    let endpoint;
                    if (metadataUri) {
                        try {
                            const response = await fetch(metadataUri);
                            if (response.ok) {
                                const metadata = await response.json();
                                endpoint = metadata.endpoint;
                            }
                        }
                        catch (err) {
                            // Ignore metadata fetch errors
                        }
                    }
                    relayers.push({
                        address: account.pubkey,
                        operator,
                        feeBps,
                        isActive: true,
                        endpoint,
                        totalTransactions: 0, // Requires full decode
                        totalFeesCollected: BigInt(0),
                    });
                }
                catch (err) {
                    console.error('Failed to parse relayer account:', err);
                }
            }
            console.log(`Found ${relayers.length} active relayers`);
            return relayers;
        }
        catch (err) {
            console.error('Failed to fetch relayers:', err);
            return [];
        }
    }
    /**
     * Select best relayer using specified strategy
     */
    async getBestRelayer(strategy = 'lowest-fee') {
        const relayers = await this.getAllActiveRelayers();
        if (relayers.length === 0) {
            return null;
        }
        switch (strategy) {
            case 'lowest-fee':
                return this.selectByFee(relayers);
            case 'reputation':
                return this.selectByReputation(relayers);
            case 'random':
                return this.selectRandom(relayers);
            default:
                return this.selectByFee(relayers);
        }
    }
    /**
     * Select relayer with lowest fee
     */
    selectByFee(relayers) {
        return relayers.reduce((best, current) => current.feeBps < best.feeBps ? current : best);
    }
    /**
     * Select relayer by reputation (most transactions)
     */
    selectByReputation(relayers) {
        return relayers.reduce((best, current) => current.totalTransactions > best.totalTransactions ? current : best);
    }
    /**
     * Select random relayer (for privacy)
     */
    selectRandom(relayers) {
        const randomIndex = Math.floor(Math.random() * relayers.length);
        return relayers[randomIndex];
    }
    /**
     * Estimate fee for a given relayer and amount
     */
    estimateFee(relayer, amount) {
        return (amount * BigInt(relayer.feeBps)) / BigInt(10000);
    }
}
exports.RelayerSelector = RelayerSelector;
/**
 * Helper: Create selector with loaded program (RECOMMENDED)
 */
async function createRelayerSelector(connection, programId, pool, idl) {
    const provider = new anchor_1.AnchorProvider(connection, {}, // Wallet not needed for read-only
    { commitment: 'confirmed' });
    const program = new anchor_1.Program(idl, programId, provider);
    return new RelayerSelector({
        connection,
        programId,
        pool,
        program,
    });
}
