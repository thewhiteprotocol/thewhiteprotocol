/**
 * Base (EVM) chain adapter for The White Protocol relayer
 */

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';

const abi = parseAbi([
  'function withdraw(bytes memory proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer) external',
  'function withdrawStealth(bytes memory proof, uint256 nullifierHash, uint256 root, address recipient, address token, uint256 amount, uint256 fee, address relayer, bytes32 ephemeralPubkey) external',
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
  'event StealthWithdrawal(bytes32 indexed ephemeralPubkey, address indexed destination, uint256 blockNumber)',
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
    fee: bigint,
    ephemeralPubkey?: `0x${string}`
  ): Promise<`0x${string}`> {
    const nullifierHash = BigInt(nullifierHashHex);
    const root = BigInt(merkleRootHex);

    const functionName = ephemeralPubkey && ephemeralPubkey !== '0x' ? 'withdrawStealth' : 'withdraw';
    const args = ephemeralPubkey && ephemeralPubkey !== '0x'
      ? [
          proofDataHex,
          nullifierHash,
          root,
          recipient,
          tokenAddr,
          amount,
          fee,
          this.account.address,
          ephemeralPubkey,
        ]
      : [
          proofDataHex,
          nullifierHash,
          root,
          recipient,
          tokenAddr,
          amount,
          fee,
          this.account.address,
        ];

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
      this.publicClient.readContract({
        address: this.contractAddress,
        abi,
        functionName: 'nextLeafIndex',
      }),
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

  async getDepositEvents(fromBlock?: bigint, toBlock?: bigint): Promise<
    Array<{
      commitment: bigint;
      amount: bigint;
      asset: `0x${string}`;
      leafIndex: bigint;
      blockNumber: bigint;
      logIndex: number;
    }>
  > {
    const logs = await this.publicClient.getContractEvents({
      address: this.contractAddress,
      abi,
      eventName: 'Deposit',
      fromBlock: fromBlock || 0n,
      toBlock: toBlock || 'latest',
    });
    return logs.map((log: any) => ({
      commitment: log.args.commitment as bigint,
      amount: log.args.amount as bigint,
      asset: log.args.asset as `0x${string}`,
      leafIndex: log.args.leafIndex as bigint,
      blockNumber: log.blockNumber as bigint,
      logIndex: Number(log.logIndex),
    }));
  }

  async getBatchSettlementEvents(fromBlock?: bigint, toBlock?: bigint): Promise<
    Array<{
      startIndex: bigint;
      batchSize: bigint;
      newRoot: bigint;
      blockNumber: bigint;
      logIndex: number;
    }>
  > {
    const logs = await this.publicClient.getContractEvents({
      address: this.contractAddress,
      abi,
      eventName: 'BatchSettlement',
      fromBlock: fromBlock || 0n,
      toBlock: toBlock || 'latest',
    });
    return logs.map((log: any) => ({
      startIndex: log.args.startIndex as bigint,
      batchSize: log.args.batchSize as bigint,
      newRoot: log.args.newRoot as bigint,
      blockNumber: log.blockNumber as bigint,
      logIndex: Number(log.logIndex),
    }));
  }
}
