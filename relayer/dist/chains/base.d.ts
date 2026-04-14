/**
 * Base (EVM) chain adapter for The White Protocol relayer
 */
export interface BaseConfig {
    rpcEndpoint: string;
    contractAddress: string;
    privateKey: string;
    chainId: number;
}
export declare class BaseAdapter {
    private config;
    private provider;
    private wallet;
    private contract;
    constructor(config: BaseConfig);
    initialize(abi: any): Promise<void>;
    submitWithdrawal(proofData: string, merkleRoot: string, nullifierHash: string, recipient: string, amount: bigint, assetId: string): Promise<string>;
    getMerkleRoot(): Promise<string>;
    getProvider(): any;
    getWallet(): any;
}
//# sourceMappingURL=base.d.ts.map