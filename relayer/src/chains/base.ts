/**
 * Base (EVM) chain adapter for The White Protocol relayer
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const abi = parseAbi([
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

export interface BaseConfig {
  rpcEndpoint: string;
  contractAddress: `0x${string}`;
  privateKey: `0x${string}`;
}

export class BaseAdapter {
  private publicClient;
  private walletClient;
  private contractAddress: `0x${string}`;
  private account;

  constructor(config: BaseConfig) {
    this.contractAddress = config.contractAddress;
    const pk = config.privateKey.startsWith('0x') ? config.privateKey : (`0x${config.privateKey}` as `0x${string}`);
    this.account = privateKeyToAccount(pk);
    this.publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(config.rpcEndpoint),
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain: baseSepolia,
      transport: http(config.rpcEndpoint),
    });
  }

  getAddress(): `0x${string}` {
    return this.account.address;
  }

  async submitWithdrawal(
    proofDataHex: `0x${string}`,
    nullifierHashHex: `0x${string}`,
    merkleRootHex: `0x${string}`,
    recipient: `0x${string}`,
    tokenAddr: `0x${string}`,
    amount: bigint,
    fee: bigint
  ): Promise<`0x${string}`> {
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

  async isSpent(nullifierHash: bigint | string): Promise<boolean> {
    const value = typeof nullifierHash === 'string' ? BigInt(nullifierHash) : nullifierHash;
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi,
      functionName: 'isSpent',
      args: [value],
    }) as Promise<boolean>;
  }

  async getCommitmentPendingIndex(commitment: bigint | string): Promise<bigint> {
    const value = typeof commitment === 'string' ? BigInt(commitment) : commitment;
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi,
      functionName: 'commitmentToPendingIndex',
      args: [value],
    }) as Promise<bigint>;
  }

  async getPoolState(): Promise<{ currentRoot: bigint; currentRootIndex: bigint; levels: bigint }> {
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

  getPendingCount(): number {
    // Placeholder: the contract does not expose a direct pending count
    return 0;
  }
}
