// The White Protocol JoinSplit Circuit
// Proves:
// 1. Input commitments exist in Merkle tree
// 2. Input nullifiers are correctly derived
// 3. Output commitments are correctly formed
// 4. Value is conserved: sum(inputs) + public_amount = sum(outputs)
// 5. All amounts are positive (no negative values)

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/mux1.circom";
include "./merkle_tree.circom";

// Maximum inputs and outputs per JoinSplit
// 2-in-2-out is standard for most privacy protocols
template JoinSplit(levels, nInputs, nOutputs) {
    // ================================
    // PUBLIC INPUTS (10 total for 2-in-2-out)
    // ================================
    signal input merkle_root;
    signal input asset_id;
    signal input input_nullifiers[nInputs];
    signal input output_commitments[nOutputs];
    signal input public_amount;  // Can be negative (withdrawal) or positive (deposit)
    signal input relayer;
    signal input relayer_fee;
    
    // ================================
    // PRIVATE INPUTS - For each input note
    // ================================
    signal input input_secrets[nInputs];
    signal input input_nullifier_preimages[nInputs];
    signal input input_amounts[nInputs];
    signal input input_leaf_indices[nInputs];
    signal input input_merkle_paths[nInputs][levels];
    signal input input_path_indices[nInputs][levels];
    
    // ================================
    // PRIVATE INPUTS - For each output note
    // ================================
    signal input output_secrets[nOutputs];
    signal input output_nullifier_preimages[nOutputs];
    signal input output_amounts[nOutputs];
    
    // ================================
    // COMPONENT DECLARATIONS (must be outside loops)
    // ================================
    component input_commitment_hashers[nInputs];
    component input_nullifier_hashers_inner[nInputs];
    component input_nullifier_hashers_outer[nInputs];
    component input_merkle_verifiers[nInputs];
    component input_amount_checks[nInputs];
    
    component output_commitment_hashers[nOutputs];
    component output_amount_checks[nOutputs];
    
    component fee_check = Num2Bits(64);
    
    // ================================
    // INPUT NOTE VERIFICATION
    // ================================
    signal input_total[nInputs + 1];
    input_total[0] <== 0;
    
    for (var i = 0; i < nInputs; i++) {
        // Compute commitment = Poseidon(secret, nullifier, amount, asset_id)
        input_commitment_hashers[i] = Poseidon(4);
        input_commitment_hashers[i].inputs[0] <== input_secrets[i];
        input_commitment_hashers[i].inputs[1] <== input_nullifier_preimages[i];
        input_commitment_hashers[i].inputs[2] <== input_amounts[i];
        input_commitment_hashers[i].inputs[3] <== asset_id;
        
        // Compute nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
        input_nullifier_hashers_inner[i] = Poseidon(2);
        input_nullifier_hashers_inner[i].inputs[0] <== input_nullifier_preimages[i];
        input_nullifier_hashers_inner[i].inputs[1] <== input_secrets[i];
        
        input_nullifier_hashers_outer[i] = Poseidon(2);
        input_nullifier_hashers_outer[i].inputs[0] <== input_nullifier_hashers_inner[i].out;
        input_nullifier_hashers_outer[i].inputs[1] <== input_leaf_indices[i];
        
        // Verify nullifier matches public input
        input_nullifier_hashers_outer[i].out === input_nullifiers[i];
        
        // Verify Merkle proof
        input_merkle_verifiers[i] = MerkleTreeChecker(levels);
        input_merkle_verifiers[i].leaf <== input_commitment_hashers[i].out;
        input_merkle_verifiers[i].root <== merkle_root;
        
        for (var j = 0; j < levels; j++) {
            input_merkle_verifiers[i].pathElements[j] <== input_merkle_paths[i][j];
            input_merkle_verifiers[i].pathIndices[j] <== input_path_indices[i][j];
        }
        
        // Accumulate input total
        input_total[i + 1] <== input_total[i] + input_amounts[i];
        
        // Verify input amount is non-negative (using range check)
        input_amount_checks[i] = Num2Bits(64);
        input_amount_checks[i].in <== input_amounts[i];
    }
    
    // ================================
    // OUTPUT NOTE VERIFICATION
    // ================================
    signal output_total[nOutputs + 1];
    output_total[0] <== 0;
    
    for (var i = 0; i < nOutputs; i++) {
        // Compute output commitment
        output_commitment_hashers[i] = Poseidon(4);
        output_commitment_hashers[i].inputs[0] <== output_secrets[i];
        output_commitment_hashers[i].inputs[1] <== output_nullifier_preimages[i];
        output_commitment_hashers[i].inputs[2] <== output_amounts[i];
        output_commitment_hashers[i].inputs[3] <== asset_id;
        
        // Verify output commitment matches public input
        output_commitment_hashers[i].out === output_commitments[i];
        
        // Accumulate output total
        output_total[i + 1] <== output_total[i] + output_amounts[i];
        
        // Verify output amount is non-negative (using range check)
        output_amount_checks[i] = Num2Bits(64);
        output_amount_checks[i].in <== output_amounts[i];
    }
    
    // ================================
    // VALUE CONSERVATION
    // sum(inputs) + public_amount = sum(outputs) + relayer_fee
    // ================================
    input_total[nInputs] + public_amount === output_total[nOutputs] + relayer_fee;
    
    // ================================
    // FEE VALIDATION
    // Fee must be non-negative
    // ================================
    fee_check.in <== relayer_fee;
    
    // ================================
    // RELAYER CONSTRAINT
    // Ensure relayer is constrained
    // ================================
    signal dummy_relayer;
    dummy_relayer <== relayer * relayer;
}

// Standard 2-in-2-out JoinSplit for depth 20 tree
component main {public [
    merkle_root,
    asset_id,
    input_nullifiers,
    output_commitments,
    public_amount,
    relayer,
    relayer_fee
]} = JoinSplit(20, 2, 2);
