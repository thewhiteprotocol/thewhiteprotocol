/**
 * pSOL v2 SDK - Merkle Tree
 *
 * Client-side Merkle tree for proof generation.
 * Mirrors the on-chain incremental Merkle tree.
 *
 * @module merkle/tree
 */
/**
 * Merkle proof structure
 */
export interface MerkleProof {
    /** Sibling hashes from leaf to root */
    pathElements: bigint[];
    /** Path indices (0 = left, 1 = right) */
    pathIndices: number[];
    /** Leaf value */
    leaf: bigint;
    /** Root after this leaf was inserted */
    root: bigint;
    /** Leaf index */
    leafIndex: number;
}
/**
 * Incremental Merkle Tree
 * Matches the on-chain MerkleTreeV2 structure
 */
export declare class MerkleTree {
    /** Tree depth */
    readonly depth: number;
    /** Maximum number of leaves */
    readonly maxLeaves: number;
    /** Current number of leaves */
    private nextIndex;
    /** Filled subtrees (for efficient insertion) */
    private filledSubtrees;
    /** Zero values at each level */
    private zeros;
    /** All leaves (for proof generation) */
    private leaves;
    /** Root history */
    private rootHistory;
    /** Current root */
    private _root;
    constructor(depth: number);
    /**
     * Initialize Poseidon (must be called before using tree)
     */
    static create(depth: number): Promise<MerkleTree>;
    /**
     * Get current root
     */
    get root(): bigint;
    /**
     * Get next available leaf index
     */
    get nextLeafIndex(): number;
    /**
     * Check if tree is full
     */
    get isFull(): boolean;
    /**
     * Insert a leaf and return its index
     */
    insert(leaf: bigint): number;
    /**
     * Generate Merkle proof for a leaf
     */
    generateProof(leafIndex: number): MerkleProof;
    /**
     * Verify a Merkle proof
     */
    static verifyProof(proof: MerkleProof): boolean;
    /**
     * Check if a root is known (current or historical)
     */
    isKnownRoot(root: bigint): boolean;
    /**
     * Get root at a specific leaf index
     */
    getRootAtIndex(leafIndex: number): bigint | undefined;
    /**
     * Serialize tree state
     */
    serialize(): string;
    /**
     * Deserialize tree state
     */
    static deserialize(data: string): Promise<MerkleTree>;
}
/**
 * Sync Merkle tree with on-chain state
 */
export declare function syncTreeWithChain(tree: MerkleTree, onChainLeaves: bigint[]): Promise<void>;
//# sourceMappingURL=tree.d.ts.map