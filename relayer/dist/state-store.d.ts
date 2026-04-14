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
export declare function loadRelayerState(): RelayerState | null;
export declare function saveRelayerState(state: RelayerState): void;
export declare function loadMerkleTreeState(): MerkleTreeState | null;
export declare function saveMerkleTreeState(state: MerkleTreeState): void;
//# sourceMappingURL=state-store.d.ts.map