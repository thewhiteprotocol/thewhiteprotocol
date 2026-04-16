/**
 * Base (EVM) chain adapter for The White Protocol relayer
 */
export interface BaseConfig {
    rpcEndpoint: string;
    contractAddress: `0x${string}`;
    privateKey: `0x${string}`;
}
export declare class BaseAdapter {
    private publicClient;
    private walletClient;
    private contractAddress;
    private account;
    constructor(config: BaseConfig);
    getAddress(): `0x${string}`;
    submitWithdrawal(proofDataHex: `0x${string}`, nullifierHashHex: `0x${string}`, merkleRootHex: `0x${string}`, recipient: `0x${string}`, tokenAddr: `0x${string}`, amount: bigint, fee: bigint): Promise<`0x${string}`>;
    isSpent(nullifierHash: bigint | string): Promise<boolean>;
    getCommitmentPendingIndex(commitment: bigint | string): Promise<bigint>;
    getPoolState(): Promise<{
        currentRoot: bigint;
        currentRootIndex: bigint;
        levels: bigint;
    }>;
    getPendingCount(): number;
}
//# sourceMappingURL=base.d.ts.map