// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "poseidon-solidity/PoseidonT3.sol";

/**
 * @title MerkleTreeWithHistory
 * @notice Incremental Merkle tree with history of recent roots
 * @dev Uses Poseidon hash for tree operations, compatible with circomlib
 */
contract MerkleTreeWithHistory {
    uint256 public constant LEVELS = 20;
    uint256 public constant ROOT_HISTORY_SIZE = 30;
    uint256 public constant SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    
    uint256 public nextLeafIndex;
    uint256 public currentRootIndex;
    uint256[LEVELS] public filledSubtrees;
    uint256[ROOT_HISTORY_SIZE] public roots;
    
    // Pre-computed zero values for each level (computed as poseidon(0,0) recursively)
    // These match the values in poseidon-incremental-merkle-tree library
    function zeros(uint256 i) public pure returns (uint256) {
        if (i == 0) return uint256(0x0);
        else if (i == 1) return uint256(0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864);
        else if (i == 2) return uint256(0x1069673dcdb12263df301a6ff584a7ec261a44cb9dc68df067a4774460b1f1e1);
        else if (i == 3) return uint256(0x18f43331537ee2af2e3d758d50f72106467c6eea50371dd528d57eb2b856d238);
        else if (i == 4) return uint256(0x07f9d837cb17b0d36320ffe93ba52345f1b728571a568265caac97559dbc952a);
        else if (i == 5) return uint256(0x2b94cf5e8746b3f5c9631f4c5df32907a699c58c94b2ad4d7b5cec1639183f55);
        else if (i == 6) return uint256(0x2dee93c5a666459646ea7d22cca9e1bcfed71e6951b953611d11dda32ea09d78);
        else if (i == 7) return uint256(0x078295e5a22b84e982cf601eb639597b8b0515a88cb5ac7fa8a4aabe3c87349d);
        else if (i == 8) return uint256(0x2fa5e5f18f6027a6501bec864564472a616b2e274a41211a444cbe3a99f3cc61);
        else if (i == 9) return uint256(0x0e884376d0d8fd21ecb780389e941f66e45e7acce3e228ab3e2156a614fcd747);
        else if (i == 10) return uint256(0x1b7201da72494f1e28717ad1a52eb469f95892f957713533de6175e5da190af2);
        else if (i == 11) return uint256(0x1f8d8822725e36385200c0b201249819a6e6e1e4650808b5bebc6bface7d7636);
        else if (i == 12) return uint256(0x2c5d82f66c914bafb9701589ba8cfcfb6162b0a12acf88a8d0879a0471b5f85a);
        else if (i == 13) return uint256(0x14c54148a0940bb820957f5adf3fa1134ef5c4aaa113f4646458f270e0bfbfd0);
        else if (i == 14) return uint256(0x190d33b12f986f961e10c0ee44d8b9af11be25588cad89d416118e4bf4ebe80c);
        else if (i == 15) return uint256(0x22f98aa9ce704152ac17354914ad73ed1167ae6596af510aa5b3649325e06c92);
        else if (i == 16) return uint256(0x2a7c7c9b6ce5880b9f6f228d72bf6a575a526f29c66ecceef8b753d38bba7323);
        else if (i == 17) return uint256(0x2e8186e558698ec1c67af9c14d463ffc470043c9c2988b954d75dd643f36b992);
        else if (i == 18) return uint256(0x0f57c5571e9a4eab49e2c8cf050dae948aef6ead647392273546249d1c1ff10f);
        else if (i == 19) return uint256(0x1830ee67b5fb554ad5f63d4388800e1cfe78e310697d46e43c9ce36134f72cca);
        else if (i == 20) return uint256(0x2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e);
        else revert('Index out of bounds');
    }
    
    constructor() {
        // Initialize filledSubtrees with zero values
        for (uint256 i = 0; i < LEVELS; i++) {
            filledSubtrees[i] = zeros(i);
        }
        // Initial root is zeros(LEVELS)
        roots[0] = zeros(LEVELS);
    }
    
    /**
     * @notice Hash two values using Poseidon
     */
    function hashLeftRight(uint256 _left, uint256 _right) public pure returns (uint256) {
        require(_left < SNARK_SCALAR_FIELD, '_left should be inside the SNARK field');
        require(_right < SNARK_SCALAR_FIELD, '_right should be inside the SNARK field');
        uint256[2] memory input = [_left, _right];
        return PoseidonT3.hash(input);
    }
    
    /**
     * @notice Insert a new leaf into the tree
     * @param leaf The leaf value to insert
     * @return newRoot The new Merkle root after insertion
     */
    function insert(uint256 leaf) internal returns (uint256 newRoot) {
        uint256 currentIndex = nextLeafIndex;
        require(currentIndex < 2**LEVELS, "Merkle tree full");
        require(leaf < SNARK_SCALAR_FIELD, "Leaf should be inside SNARK field");
        
        uint256 currentHash = leaf;
        
        for (uint256 i = 0; i < LEVELS; i++) {
            if (currentIndex % 2 == 0) {
                // Left side
                filledSubtrees[i] = currentHash;
                currentHash = hashLeftRight(currentHash, zeros(i));
            } else {
                // Right side
                currentHash = hashLeftRight(filledSubtrees[i], currentHash);
            }
            currentIndex /= 2;
        }
        
        newRoot = currentHash;
        currentRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        roots[currentRootIndex] = newRoot;
        nextLeafIndex++;
        
        return newRoot;
    }
    
    /**
     * @notice Check if a root is in the recent history
     * @param root The root to check
     * @return bool True if root is known
     */
    function isKnownRoot(uint256 root) public view returns (bool) {
        if (root == 0) return false;
        uint256 i = currentRootIndex;
        do {
            if (roots[i] == root) return true;
            if (i == 0) i = ROOT_HISTORY_SIZE;
            i--;
        } while (i != currentRootIndex);
        return false;
    }
    
    /**
     * @notice Get the most recent root
     * @return uint256 The current root
     */
    function getLastRoot() public view returns (uint256) {
        return roots[currentRootIndex];
    }
}
