"use strict";
/**
 * Base (EVM) chain adapter for The White Protocol relayer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAdapter = void 0;
const viem_1 = require("viem");
const accounts_1 = require("viem/accounts");
const chains_1 = require("viem/chains");
const abi = (0, viem_1.parseAbi)([
    'function withdraw(bytes memory proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external',
    'function getLastRoot() external view returns (uint256)',
    'function roots(uint256 index) external view returns (uint256)',
    'function currentRootIndex() external view returns (uint256)',
    'function commitmentToPendingIndex(uint256 commitment) external view returns (uint256)',
    'function isSpent(uint256 nullifierHash) external view returns (bool)',
    'function LEVELS() external view returns (uint256)',
    'event Deposit(uint256 indexed commitment, uint256 amount, address indexed asset, uint256 leafIndex)',
    'event BatchSettlement(uint256 indexed startIndex, uint256 batchSize, uint256 newRoot)',
]);
class BaseAdapter {
    publicClient;
    walletClient;
    contractAddress;
    account;
    constructor(config) {
        this.contractAddress = config.contractAddress;
        const pk = config.privateKey.startsWith('0x') ? config.privateKey : `0x${config.privateKey}`;
        this.account = (0, accounts_1.privateKeyToAccount)(pk);
        this.publicClient = (0, viem_1.createPublicClient)({
            chain: chains_1.baseSepolia,
            transport: (0, viem_1.http)(config.rpcEndpoint),
        });
        this.walletClient = (0, viem_1.createWalletClient)({
            account: this.account,
            chain: chains_1.baseSepolia,
            transport: (0, viem_1.http)(config.rpcEndpoint),
        });
    }
    getAddress() {
        return this.account.address;
    }
    async submitWithdrawal(proofDataHex, nullifierHashHex, merkleRootHex, recipient, tokenAddr, amount, fee) {
        const nullifierHash = BigInt(nullifierHashHex);
        const root = BigInt(merkleRootHex);
        const hash = await this.walletClient.writeContract({
            address: this.contractAddress,
            abi,
            functionName: 'withdraw',
            args: [
                proofDataHex,
                nullifierHash,
                root,
                recipient,
                tokenAddr,
                amount,
                fee,
                this.account.address,
            ],
        });
        return hash;
    }
    async isSpent(nullifierHash) {
        const value = typeof nullifierHash === 'string' ? BigInt(nullifierHash) : nullifierHash;
        return this.publicClient.readContract({
            address: this.contractAddress,
            abi,
            functionName: 'isSpent',
            args: [value],
        });
    }
    async getCommitmentPendingIndex(commitment) {
        const value = typeof commitment === 'string' ? BigInt(commitment) : commitment;
        return this.publicClient.readContract({
            address: this.contractAddress,
            abi,
            functionName: 'commitmentToPendingIndex',
            args: [value],
        });
    }
    async getPoolState() {
        const [currentRoot, currentRootIndex, levels] = await Promise.all([
            this.publicClient.readContract({
                address: this.contractAddress,
                abi,
                functionName: 'getLastRoot',
            }),
            this.publicClient.readContract({
                address: this.contractAddress,
                abi,
                functionName: 'currentRootIndex',
            }),
            this.publicClient.readContract({
                address: this.contractAddress,
                abi,
                functionName: 'LEVELS',
            }),
        ]);
        return { currentRoot, currentRootIndex, levels };
    }
    getPendingCount() {
        // Placeholder: the contract does not expose a direct pending count
        return 0;
    }
}
exports.BaseAdapter = BaseAdapter;
