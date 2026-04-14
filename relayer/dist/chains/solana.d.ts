/**
 * Solana chain adapter for The White Protocol relayer
 */
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
export interface SolanaConfig {
    rpcEndpoint: string;
    programId: PublicKey;
    poolConfig: PublicKey;
    walletKeypair: Keypair;
}
export declare class SolanaAdapter {
    private config;
    private connection;
    private program;
    private provider;
    constructor(config: SolanaConfig);
    initialize(idlPath: string): Promise<void>;
    submitWithdrawal(proofData: Buffer, merkleRoot: Buffer, nullifierHash: Buffer, recipient: PublicKey, amount: bigint, assetId: Buffer): Promise<string>;
    getMerkleRoot(): Promise<Buffer>;
    getConnection(): Connection;
}
//# sourceMappingURL=solana.d.ts.map