// Merkle Tree Circuit Components for The White Protocol
// Shared by all proof circuits

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/switcher.circom";

// Computes Poseidon hash of two elements
// Used for Merkle tree internal nodes
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}

// Single level of Merkle proof verification
template MerkleTreeLevel() {
    signal input leaf;
    signal input pathElement;
    signal input pathIndex;  // 0 = leaf is left, 1 = leaf is right
    signal output root;
    
    // Ensure pathIndex is binary
    pathIndex * (1 - pathIndex) === 0;
    
    // Switcher: if pathIndex = 0, leaf goes left
    // if pathIndex = 1, leaf goes right
    component switcher = Switcher();
    switcher.sel <== pathIndex;
    switcher.L <== leaf;
    switcher.R <== pathElement;
    
    // Hash the two children
    component hasher = HashLeftRight();
    hasher.left <== switcher.outL;
    hasher.right <== switcher.outR;
    
    root <== hasher.hash;
}

// Full Merkle tree proof verification
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    // Compute root from leaf and path
    component levels_comp[levels];
    
    for (var i = 0; i < levels; i++) {
        levels_comp[i] = MerkleTreeLevel();
        
        if (i == 0) {
            levels_comp[i].leaf <== leaf;
        } else {
            levels_comp[i].leaf <== levels_comp[i-1].root;
        }
        
        levels_comp[i].pathElement <== pathElements[i];
        levels_comp[i].pathIndex <== pathIndices[i];
    }
    
    // Verify computed root equals expected root
    root === levels_comp[levels-1].root;
}

// Compute leaf index from path indices
// Used to verify nullifier is correctly bound to leaf position
template LeafIndexFromPath(levels) {
    signal input pathIndices[levels];
    signal output index;
    
    signal acc[levels + 1];
    acc[0] <== 0;
    
    for (var i = 0; i < levels; i++) {
        acc[i + 1] <== acc[i] + pathIndices[i] * (1 << i);
    }
    
    index <== acc[levels];
}

// Incremental Merkle tree update
// Takes old root and produces new root after inserting leaf at index
template MerkleTreeUpdater(levels) {
    signal input oldRoot;
    signal input newLeaf;
    signal input leafIndex;
    signal input pathElements[levels];
    signal output newRoot;
    
    // Decompose leaf index to bits
    component indexBits = Num2Bits(levels);
    indexBits.in <== leafIndex;
    
    // First verify old state (should have zero at leaf position)
    component oldChecker = MerkleTreeChecker(levels);
    oldChecker.leaf <== 0;  // Old leaf was zero
    oldChecker.root <== oldRoot;
    
    for (var i = 0; i < levels; i++) {
        oldChecker.pathElements[i] <== pathElements[i];
        oldChecker.pathIndices[i] <== indexBits.out[i];
    }
    
    // Compute new root with new leaf
    component levels_comp[levels];
    
    for (var i = 0; i < levels; i++) {
        levels_comp[i] = MerkleTreeLevel();
        
        if (i == 0) {
            levels_comp[i].leaf <== newLeaf;
        } else {
            levels_comp[i].leaf <== levels_comp[i-1].root;
        }
        
        levels_comp[i].pathElement <== pathElements[i];
        levels_comp[i].pathIndex <== indexBits.out[i];
    }
    
    newRoot <== levels_comp[levels-1].root;
}
