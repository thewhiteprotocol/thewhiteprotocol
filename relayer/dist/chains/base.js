"use strict";
/**
 * Base (EVM) chain adapter for The White Protocol relayer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAdapter = void 0;
const ethers_1 = require("ethers");
class BaseAdapter {
    constructor(config) {
        this.config = config;
        this.contract = null;
        this.provider = new ethers_1.ethers.providers.JsonRpcProvider(config.rpcEndpoint, config.chainId);
        this.wallet = new ethers_1.ethers.Wallet(config.privateKey, this.provider);
    }
    async initialize(abi) {
        this.contract = new ethers_1.ethers.Contract(this.config.contractAddress, abi, this.wallet);
    }
    async submitWithdrawal(proofData, merkleRoot, nullifierHash, recipient, amount, assetId) {
        if (!this.contract) {
            throw new Error('Base adapter not initialized');
        }
        // Implementation would call the withdraw function on the contract
        // This is a placeholder showing the interface
        const tx = await this.contract.withdraw(proofData, merkleRoot, nullifierHash, recipient, amount, assetId);
        const receipt = await tx.wait();
        return receipt.hash;
    }
    async getMerkleRoot() {
        if (!this.contract) {
            throw new Error('Base adapter not initialized');
        }
        return await this.contract.merkleRoot();
    }
    getProvider() {
        return this.provider;
    }
    getWallet() {
        return this.wallet;
    }
}
exports.BaseAdapter = BaseAdapter;
