// The White Protocol Deposit Circuit
// Proves:
// 1. commitment = Poseidon(secret, nullifier, amount, asset_id)
// 2. amount > 0
// 3. commitment is non-zero
//
// Note: Deposit proofs are optional in The White Protocol. The on-chain program
// can accept deposits without proof verification for simplicity.
// This circuit is provided for complete ZK coverage if desired.

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

template Deposit() {
    // ================================
    // PUBLIC INPUTS (3 total)
    // ================================
    signal input commitment;
    signal input amount;
    signal input asset_id;
    
    // ================================
    // PRIVATE INPUTS
    // ================================
    signal input secret;
    signal input nullifier;
    
    // ================================
    // COMMITMENT COMPUTATION
    // commitment = Poseidon(secret, nullifier, amount, asset_id)
    // ================================
    component commitment_hasher = Poseidon(4);
    commitment_hasher.inputs[0] <== secret;
    commitment_hasher.inputs[1] <== nullifier;
    commitment_hasher.inputs[2] <== amount;
    commitment_hasher.inputs[3] <== asset_id;
    
    // Verify commitment matches public input
    commitment_hasher.out === commitment;
    
    // ================================
    // AMOUNT VALIDATION
    // Ensure amount > 0
    // ================================
    component amount_check = GreaterThan(64);
    amount_check.in[0] <== amount;
    amount_check.in[1] <== 0;
    amount_check.out === 1;
    
    // ================================
    // COMMITMENT NON-ZERO CHECK
    // Ensure commitment is not zero (would be invalid leaf)
    // ================================
    component commitment_nonzero = IsZero();
    commitment_nonzero.in <== commitment;
    commitment_nonzero.out === 0;  // Must be non-zero
    
    // ================================
    // NULLIFIER NON-ZERO CHECK
    // Ensure nullifier is valid
    // ================================
    component nullifier_nonzero = IsZero();
    nullifier_nonzero.in <== nullifier;
    nullifier_nonzero.out === 0;  // Must be non-zero
    
    // ================================
    // SECRET NON-ZERO CHECK
    // Ensure secret is valid
    // ================================
    component secret_nonzero = IsZero();
    secret_nonzero.in <== secret;
    secret_nonzero.out === 0;  // Must be non-zero
}

component main {public [commitment, amount, asset_id]} = Deposit();
