/**
 * Generic EVM chain adapter for The White Protocol relayer
 * Supports Base, Ethereum, Polygon
 */

import { createPublicClient, createWalletClient, http, parseAbi, Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  baseSepolia,
  sepolia,
  polygonAmoy,
  base,
  mainnet,
  polygon,
  bscTestnet,
  bsc,
} from 'viem/chains';

const CHAIN_MAP: Record<number, Chain> = {
  84532: baseSepolia,
  11155111: sepolia,
  80002: polygonAmoy,
  8453: base,
  1: mainnet,
  137: polygon,
  97: bscTestnet,
  56: bsc,
};

const abi = parseAbi([
  'function withdraw(bytes memory proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external',
  'function withdrawStealth(bytes memory proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer, bytes ephemeralPubkey) external',
  'function settleBatch(bytes memory proof, uint256 oldRoot, uint256 newRoot, uint256 startIndex, uint256 batchSize, uint256 commitmentsHash) external',
  'function getLastRoot() external view returns (uint256)',
  'function roots(uint256 index) external view returns (uint256)',
  'function currentRootIndex() external view returns (uint256)',
  'function nextLeafIndex() external view returns (uint256)',
  'function commitmentToPendingIndex(uint256 commitment) external view returns (uint256)',
  'function isSpent(uint256 nullifierHash) external view returns (bool)',
  'function LEVELS() external view returns (uint256)',
  'function getPendingDepositsCount() external view returns (uint256)',
  'function getPendingDeposit(uint256 index) external view returns (uint256)',
  'event Deposit(uint256 indexed commitment, uint256 amount, address indexed asset, uint256 leafIndex)',
  'event BatchSettlement(uint256 indexed startIndex, uint256 batchSize, uint256 newRoot)',
  'event StealthWithdrawal(bytes ephemeralPubkey, address indexed destination, uint256 blockNumber)',
]);

export interface EvmConfig {
  chainId: number;
  rpcEndpoint: string;
  contractAddress: `0x${string}`;
  privateKey: `0x${string}`;
}

export class EvmAdapter {
  private publicClient;
  private walletClient;
  private contractAddress: `0x${string}`;
  private account;
  public readonly chainId: number;
  public readonly chainName: string;

  constructor(public readonly name: string, config: EvmConfig) {
    this.chainId = config.chainId;
    this.contractAddress = config.contractAddress;
    const pk = config.privateKey.startsWith('0x')
      ? config.privateKey
      : (`0x${config.privateKey}` as `0x${string}`);
    this.account = privateKeyToAccount(pk);
    const chain = CHAIN_MAP[config.chainId];
    if (!chain) {
      throw new Error(`Unsupported chain ID: ${config.chainId}`);
    }
    this.chainName = chain.name;
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcEndpoint),
    });
    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(config.rpcEndpoint),
    });
  }

  getAddress(): `0x${string}` {
    return this.account.address;
  }

  async getBalance(): Promise<bigint> {
    return this.publicClient.getBalance({ address: this.account.address });
  }

  async submitWithdrawal(
    proofDataHex: `0x${string}`,
    nullifierHashHex: `0x${string}`,
    merkleRootHex: `0x${string}`,
    recipient: `0x${string}`,
    tokenAddr: `0x${string}`,
    amount: bigint,
    fee: bigint,
    ephemeralPubkey?: `0x${string}`
  ): Promise<`0x${string}`> {
    const nullifierHash = BigInt(nullifierHashHex);
    const root = BigInt(merkleRootHex);

    const functionName = ephemeralPubkey && ephemeralPubkey !== '0x' ? 'withdrawStealth' : 'withdraw';
    const args = ephemeralPubkey && ephemeralPubkey !== '0x'
      ? [proofDataHex, nullifierHash, root, recipient, tokenAddr, amount, fee, this.account.address, ephemeralPubkey]
      : [proofDataHex, nullifierHash, root, recipient, tokenAddr, amount, fee, this.account.address];

    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi,
      functionName,
      args,
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

  async getPoolState(): Promise<{ currentRoot: bigint; currentRootIndex: bigint; levels: bigint; nextLeafIndex: bigint }> {
    const [currentRoot, currentRootIndex, levels, nextLeafIndex] = await Promise.all([
      this.publicClient.readContract({ address: this.contractAddress, abi, functionName: 'getLastRoot' }),
      this.publicClient.readContract({ address: this.contractAddress, abi, functionName: 'currentRootIndex' }),
      this.publicClient.readContract({ address: this.contractAddress, abi, functionName: 'LEVELS' }),
      this.publicClient.readContract({ address: this.contractAddress, abi, functionName: 'nextLeafIndex' }),
    ]);
    return { currentRoot, currentRootIndex, levels, nextLeafIndex };
  }

  async getPendingCount(): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.contractAddress,
      abi,
      functionName: 'getPendingDepositsCount',
    });
    return Number(count);
  }

  async getPendingDeposits(): Promise<bigint[]> {
    const count = await this.getPendingCount();
    if (count === 0) return [];
    const promises: Promise<bigint>[] = [];
    for (let i = 0; i < count; i++) {
      promises.push(
        this.publicClient.readContract({
          address: this.contractAddress,
          abi,
          functionName: 'getPendingDeposit',
          args: [BigInt(i)],
        }) as Promise<bigint>
      );
    }
    return Promise.all(promises);
  }

  async submitSettlement(
    proofDataHex: `0x${string}`,
    oldRoot: bigint,
    newRoot: bigint,
    startIndex: number,
    batchSize: number,
    commitmentsHash: bigint
  ): Promise<`0x${string}`> {
    const hash = await this.walletClient.writeContract({
      address: this.contractAddress,
      abi,
      functionName: 'settleBatch',
      args: [proofDataHex, oldRoot, newRoot, BigInt(startIndex), BigInt(batchSize), commitmentsHash],
    });
    return hash;
  }

  private async getEventsPaginated<T>(
    eventName: 'Deposit' | 'BatchSettlement',
    deploymentBlock: bigint,
    fromBlock?: bigint,
    toBlock?: bigint
  ): Promise<T[]> {
    const start = fromBlock || deploymentBlock;
    const end = toBlock || (await this.publicClient.getBlockNumber());
    const chunkSize = 5000n;
    const allLogs: any[] = [];

    for (let chunkStart = start; chunkStart <= end; chunkStart += chunkSize) {
      const chunkEnd = chunkStart + chunkSize > end ? end : chunkStart + chunkSize;
      try {
        const logs = await this.publicClient.getContractEvents({
          address: this.contractAddress,
          abi,
          eventName,
          fromBlock: chunkStart,
          toBlock: chunkEnd,
        });
        allLogs.push(...logs);
      } catch (err: any) {
        if (err?.message?.includes('limited to') || err?.message?.includes('range')) {
          const subChunkSize = 2000n;
          for (let subStart = chunkStart; subStart <= chunkEnd; subStart += subChunkSize) {
            const subEnd = subStart + subChunkSize > chunkEnd ? chunkEnd : subStart + subChunkSize;
            const subLogs = await this.publicClient.getContractEvents({
              address: this.contractAddress,
              abi,
              eventName,
              fromBlock: subStart,
              toBlock: subEnd,
            });
            allLogs.push(...subLogs);
          }
        } else {
          throw err;
        }
      }
      await new Promise(r => setTimeout(r, 150));
    }

    return allLogs as T[];
  }

  async getDepositEvents(deploymentBlock: bigint, fromBlock?: bigint, toBlock?: bigint): Promise<
    Array<{
      commitment: bigint;
      amount: bigint;
      asset: `0x${string}`;
      leafIndex: bigint;
      blockNumber: bigint;
      logIndex: number;
    }>
  > {
    const logs = await this.getEventsPaginated('Deposit', deploymentBlock, fromBlock, toBlock);
    return logs.map((log: any) => ({
      commitment: log.args.commitment as bigint,
      amount: log.args.amount as bigint,
      asset: log.args.asset as `0x${string}`,
      leafIndex: log.args.leafIndex as bigint,
      blockNumber: log.blockNumber as bigint,
      logIndex: Number(log.logIndex),
    }));
  }

  async getBatchSettlementEvents(deploymentBlock: bigint, fromBlock?: bigint, toBlock?: bigint): Promise<
    Array<{
      startIndex: bigint;
      batchSize: bigint;
      newRoot: bigint;
      blockNumber: bigint;
      logIndex: number;
    }>
  > {
    const logs = await this.getEventsPaginated('BatchSettlement', deploymentBlock, fromBlock, toBlock);
    return logs.map((log: any) => ({
      startIndex: log.args.startIndex as bigint,
      batchSize: log.args.batchSize as bigint,
      newRoot: log.args.newRoot as bigint,
      blockNumber: log.blockNumber as bigint,
      logIndex: Number(log.logIndex),
    }));
  }
}
