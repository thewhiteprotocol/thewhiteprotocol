// The White Protocol Membership Proof Circuit
// Proves:
// 1. User has a commitment in the Merkle tree
// 2. The commitment amount >= threshold
// 3. Does NOT reveal the nullifier (non-spending proof)
//
// Use cases:
// - Prove minimum stake for governance
// - Prove membership in pool without revealing identity
// - Access control based on token holdings

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../merkle_tree.circom";

template Membership(levels) {
    // ================================
    // PUBLIC INPUTS (4 total)
    // ================================
    signal input merkle_root;
    signal input commitment_hash;  // Hash of commitment (for linkability prevention)
    signal input threshold;
    signal input asset_id;
    
    // ================================
    // PRIVATE INPUTS
    // ================================
    signal input secret;
    signal input nullifier;
    signal input amount;
    signal input leaf_index;
    signal input merkle_path[levels];
    signal input path_indices[levels];
    
    // ================================
    // COMMITMENT COMPUTATION
    // ================================
    component commitment_hasher = Poseidon(4);
    commitment_hasher.inputs[0] <== secret;
    commitment_hasher.inputs[1] <== nullifier;
    commitment_hasher.inputs[2] <== amount;
    commitment_hasher.inputs[3] <== asset_id;
    
    signal commitment;
    commitment <== commitment_hasher.out;
    
    // ================================
    // COMMITMENT HASH VERIFICATION
    // commitment_hash = Poseidon(commitment, 0) to prevent linkability
    // ================================
    component hash_commitment = Poseidon(2);
    hash_commitment.inputs[0] <== commitment;
    hash_commitment.inputs[1] <== 0;  // Domain separator
    
    hash_commitment.out === commitment_hash;
    
    // ================================
    // MERKLE PROOF VERIFICATION
    // ================================
    component merkle_verifier = MerkleTreeChecker(levels);
    merkle_verifier.leaf <== commitment;
    merkle_verifier.root <== merkle_root;
    
    for (var i = 0; i < levels; i++) {
        merkle_verifier.pathElements[i] <== merkle_path[i];
        merkle_verifier.pathIndices[i] <== path_indices[i];
    }
    
    // ================================
    // THRESHOLD CHECK
    // amount >= threshold
    // ================================
    component threshold_check = GreaterEqThan(64);
    threshold_check.in[0] <== amount;
    threshold_check.in[1] <== threshold;
    threshold_check.out === 1;
    
    // ================================
    // AMOUNT RANGE CHECK
    // Ensure amount fits in 64 bits
    // ================================
    component amount_bits = Num2Bits(64);
    amount_bits.in <== amount;
}

// Instantiate for depth 20 tree
component main {public [
    merkle_root,
    commitment_hash,
    threshold,
    asset_id
]} = Membership(20);
