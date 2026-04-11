// The White Protocol Batch Append Circuit
// Proves correct sequential insertion of N commitments into the Merkle tree
// Permissionless: anyone can generate this proof from on-chain pending buffer data

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../merkle_tree.circom";

template BatchAppend(levels, batchSize) {
    // ================================
    // PUBLIC INPUTS (3 + batchSize)
    // On-chain verifier checks these match pending buffer state
    // ================================
    signal input oldRoot;                    // Current on-chain Merkle root
    signal input newRoot;                    // Root after inserting all commitments
    signal input startIndex;                 // next_leaf_index from on-chain state
    signal input commitments[batchSize];     // Commitments from pending buffer
    
    // ================================
    // PRIVATE INPUTS
    // Prover computes these off-chain from current tree state
    // ================================
    signal input pathElements[batchSize][levels];
    
    // ================================
    // CHAIN THE INSERTIONS
    // Each MerkleTreeUpdater:
    //   1. Verifies old tree has 0 at leaf position
    //   2. Computes new root with commitment inserted
    // ================================
    signal intermediateRoots[batchSize + 1];
    intermediateRoots[0] <== oldRoot;
    
    component updaters[batchSize];
    
    for (var i = 0; i < batchSize; i++) {
        updaters[i] = MerkleTreeUpdater(levels);
        updaters[i].oldRoot <== intermediateRoots[i];
        updaters[i].newLeaf <== commitments[i];
        updaters[i].leafIndex <== startIndex + i;
        
        for (var j = 0; j < levels; j++) {
            updaters[i].pathElements[j] <== pathElements[i][j];
        }
        
        intermediateRoots[i + 1] <== updaters[i].newRoot;
    }
    
    // ================================
    // VERIFY FINAL ROOT MATCHES
    // ================================
    newRoot === intermediateRoots[batchSize];
}

// Depth 20 tree (1M capacity), batch size 8
// Public inputs: oldRoot, newRoot, startIndex, commitments[8] = 11 total
component main {public [oldRoot, newRoot, startIndex, commitments]} = BatchAppend(20, 8);
