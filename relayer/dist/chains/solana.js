"use strict";
/**
 * Solana chain adapter for The White Protocol relayer
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
exports.SolanaAdapter = void 0;
const web3_js_1 = require("@solana/web3.js");
const anchor_1 = require("@coral-xyz/anchor");
const fs = __importStar(require("fs"));
class SolanaAdapter {
    constructor(config) {
        this.config = config;
        this.program = null;
        this.provider = null;
        this.connection = new web3_js_1.Connection(config.rpcEndpoint, 'confirmed');
    }
    async initialize(idlPath) {
        const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
        this.provider = new anchor_1.AnchorProvider(this.connection, new AnchorWallet(this.config.walletKeypair), { commitment: 'confirmed' });
        this.program = new anchor_1.Program(idl, this.provider);
    }
    async submitWithdrawal(proofData, merkleRoot, nullifierHash, recipient, amount, assetId) {
        if (!this.program) {
            throw new Error('Solana adapter not initialized');
        }
        // Implementation would construct and send the withdraw transaction
        // This is a placeholder showing the interface
        throw new Error('submitWithdrawal not yet implemented');
    }
    async getMerkleRoot() {
        // Fetch current merkle root from on-chain
        throw new Error('getMerkleRoot not yet implemented');
    }
    getConnection() {
        return this.connection;
    }
}
exports.SolanaAdapter = SolanaAdapter;
class AnchorWallet {
    constructor(payer) {
        this.payer = payer;
    }
    get publicKey() {
        return this.payer.publicKey;
    }
    async signTransaction(tx) {
        if (tx instanceof web3_js_1.Transaction) {
            tx.partialSign(this.payer);
        }
        else {
            tx.sign([this.payer]);
        }
        return tx;
    }
    async signAllTransactions(txs) {
        return txs.map(tx => {
            if (tx instanceof web3_js_1.Transaction) {
                tx.partialSign(this.payer);
            }
            else {
                tx.sign([this.payer]);
            }
            return tx;
        });
    }
}
