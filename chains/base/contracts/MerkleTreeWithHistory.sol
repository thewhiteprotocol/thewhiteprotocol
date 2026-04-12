// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./PoseidonHasher.sol";

/**
 * @title MerkleTreeWithHistory
 * @notice Incremental Merkle tree with root history (like Tornado Cash)
 * @dev Uses Poseidon hash, depth = 20, stores 30 most recent roots
 */
contract MerkleTreeWithHistory {
    using PoseidonHasher for uint256;

    uint256 public constant DEPTH = 20;
    uint256 public constant MAX_LEAVES = 2 ** DEPTH;
    uint256 public constant ROOT_HISTORY_SIZE = 30;

    // Current state
    uint256 public currentRoot;
    uint256 public nextLeafIndex;
    
    // Filled subtrees at each level
    mapping(uint256 => uint256) public filledSubtrees;
    
    // Root history (ring buffer)
    uint256[ROOT_HISTORY_SIZE] public roots;
    uint256 public currentRootIndex;
    
    // Precomputed zero values for each level
    uint256[DEPTH + 1] public zeros;

    event LeafInsertion(uint256 indexed index, uint256 leaf, uint256 newRoot);

    constructor() {
        // Compute zero values for each level
        // zeros[0] = 0, zeros[i+1] = hash(zeros[i], zeros[i])
        zeros[0] = 0;
        for (uint256 i = 0; i < DEPTH; i++) {
            zeros[i + 1] = PoseidonHasher.hash2(zeros[i], zeros[i]);
        }
        
        currentRoot = zeros[DEPTH];
        nextLeafIndex = 0;
        
        // Initialize root history
        roots[0] = currentRoot;
    }

    /**
     * @notice Insert a new leaf into the tree
     * @param leaf The leaf value (commitment hash)
     * @return The new Merkle root
     */
    function insert(uint256 leaf) public returns (uint256) {
        require(nextLeafIndex < MAX_LEAVES, "Merkle tree full");
        
        uint256 index = nextLeafIndex;
        nextLeafIndex++;
        
        uint256 currentHash = leaf;
        
        for (uint256 i = 0; i < DEPTH; i++) {
            if (index % 2 == 0) {
                // Left child
                filledSubtrees[i] = currentHash;
                currentHash = PoseidonHasher.hash2(currentHash, zeros[i]);
            } else {
                // Right child
                currentHash = PoseidonHasher.hash2(filledSubtrees[i], currentHash);
            }
            index /= 2;
        }
        
        currentRoot = currentHash;
        
        // Update root history (ring buffer)
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = currentRoot;
        
        emit LeafInsertion(nextLeafIndex - 1, leaf, currentRoot);
        
        return currentRoot;
    }

    /**
     * @notice Batch insert leaves
     * @param leaves Array of leaf values
     * @return The new Merkle root
     */
    function insertBatch(uint256[] calldata leaves) external returns (uint256) {
        for (uint256 i = 0; i < leaves.length; i++) {
            insert(leaves[i]);
        }
        return currentRoot;
    }

    /**
     * @notice Check if a root is valid (in history)
     * @param root The root to check
     * @return True if root is valid
     */
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        if (root == currentRoot) return true;
        
        for (uint256 i = 0; i < ROOT_HISTORY_SIZE; i++) {
            if (roots[i] == root) return true;
        }
        return false;
    }

    /**
     * @notice Get the last root
     */
    function getLastRoot() external view returns (uint256) {
        return currentRoot;
    }

    /**
     * @notice Get zero value for a specific level
     */
    function getZero(uint256 level) external view returns (uint256) {
        return zeros[level];
    }
}
