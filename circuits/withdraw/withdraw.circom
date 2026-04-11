// The White Protocol Withdraw Circuit
// Proves:
// 1. Commitment exists in Merkle tree at merkle_root
// 2. nullifier_hash = Poseidon(nullifier, secret, leaf_index)
// 3. commitment = Poseidon(secret, nullifier, amount, asset_id)
// 4. Public inputs are correctly bound

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../merkle_tree.circom";

template Withdraw(levels) {
    // ================================
    // PUBLIC INPUTS (8 total)
    // ================================
    signal input merkle_root;
    signal input nullifier_hash;
    signal input asset_id;
    signal input recipient;
    signal input amount;
    signal input relayer;
    signal input relayer_fee;
    signal input public_data_hash;  // Optional metadata hash
    
    // ================================
    // PRIVATE INPUTS
    // ================================
    signal input secret;
    signal input nullifier;
    signal input leaf_index;
    signal input merkle_path[levels];
    signal input merkle_path_indices[levels];
    
    // ================================
    // COMMITMENT COMPUTATION
    // Verify commitment = Poseidon(secret, nullifier, amount, asset_id)
    // ================================
    component commitment_hasher = Poseidon(4);
    commitment_hasher.inputs[0] <== secret;
    commitment_hasher.inputs[1] <== nullifier;
    commitment_hasher.inputs[2] <== amount;
    commitment_hasher.inputs[3] <== asset_id;
    
    signal commitment;
    commitment <== commitment_hasher.out;
    
    // ================================
    // NULLIFIER HASH COMPUTATION
    // nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
    // ================================
    component nullifier_inner = Poseidon(2);
    nullifier_inner.inputs[0] <== nullifier;
    nullifier_inner.inputs[1] <== secret;
    
    component nullifier_outer = Poseidon(2);
    nullifier_outer.inputs[0] <== nullifier_inner.out;
    nullifier_outer.inputs[1] <== leaf_index;
    
    // Verify nullifier hash matches public input
    nullifier_outer.out === nullifier_hash;
    
    // ================================
    // MERKLE PROOF VERIFICATION
    // ================================
    component merkle_verifier = MerkleTreeChecker(levels);
    merkle_verifier.leaf <== commitment;
    merkle_verifier.root <== merkle_root;
    
    for (var i = 0; i < levels; i++) {
        merkle_verifier.pathElements[i] <== merkle_path[i];
        merkle_verifier.pathIndices[i] <== merkle_path_indices[i];
    }
    
    // ================================
    // AMOUNT VALIDATION
    // Ensure amount > 0
    // ================================
    component amount_check = GreaterThan(64);
    amount_check.in[0] <== amount;
    amount_check.in[1] <== 0;
    amount_check.out === 1;
    
    // ================================
    // FEE VALIDATION
    // Ensure relayer_fee <= amount
    // ================================
    component fee_check = LessEqThan(64);
    fee_check.in[0] <== relayer_fee;
    fee_check.in[1] <== amount;
    fee_check.out === 1;
    
    // ================================
    // DUMMY CONSTRAINTS FOR PUBLIC INPUTS
    // These ensure all public inputs are actually constrained
    // ================================
    signal dummy_recipient;
    dummy_recipient <== recipient * recipient;
    
    signal dummy_relayer;
    dummy_relayer <== relayer * relayer;
    
    signal dummy_data_hash;
    dummy_data_hash <== public_data_hash * public_data_hash;
}

// Instantiate for depth 20 tree (2^20 = ~1M leaves)
component main {public [
    merkle_root,
    nullifier_hash,
    asset_id,
    recipient,
    amount,
    relayer,
    relayer_fee,
    public_data_hash
]} = Withdraw(20);
