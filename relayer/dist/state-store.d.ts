/**
 * Simple JSON file-based state store for the relayer.
 * Persists critical in-memory state across restarts.
 */
export interface RelayerState {
    totalTransactions: number;
    totalFeesEarned: string;
    supportedAssets: string[];
}
export interface MerkleTreeState {
    leaves: string[];
}
export interface PendingState {
    /** Pending commitments not yet settled into the Merkle tree */
    pendingCommitments: string[];
    /** Last known nextLeafIndex from on-chain Merkle tree */
    nextLeafIndex: number;
    /** Last known block height / timestamp for Solana sync */
    lastSyncedAt: number;
}
export declare function loadRelayerState(): RelayerState | null;
export declare function saveRelayerState(state: RelayerState): void;
export declare function loadMerkleTreeState(): MerkleTreeState | null;
export declare function saveMerkleTreeState(state: MerkleTreeState): void;
export declare function loadPendingState(): PendingState | null;
export declare function savePendingState(state: PendingState): void;
//# sourceMappingURL=state-store.d.ts.map