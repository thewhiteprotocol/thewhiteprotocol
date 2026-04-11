// The White Protocol Withdraw V2 Circuit (Join-Split with Change)
// Proves:
// 1. Input commitment exists in Merkle tree at merkle_root
// 2. Nullifier hashes computed correctly
// 3. Change commitment computed correctly
// 4. Value conservation: input_amount = amount + change_amount

pragma circom 2.1.6;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/bitify.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "../merkle_tree.circom";

template WithdrawV2(levels) {
    // ================================
    // PUBLIC INPUTS (12 total, EXACT ORDER MATCHES RUST)
    // ================================
    signal input schema_version;      // 1. Must equal 2
    signal input merkle_root;         // 2. Merkle tree root
    signal input asset_id;            // 3. Asset being withdrawn
    signal input nullifier_hash_0;    // 4. Primary nullifier hash
    signal input nullifier_hash_1;    // 5. Secondary nullifier (0 if unused)
    signal input change_commitment;   // 6. Change output commitment
    signal input recipient;           // 7. Withdrawal recipient
    signal input amount;              // 8. Withdrawal amount (before fee)
    signal input relayer;             // 9. Relayer address
    signal input relayer_fee;         // 10. Fee paid to relayer
    signal input public_data_hash;    // 11. Optional metadata hash
    signal input reserved_0;          // 12. Reserved (must be 0)
    
    // ================================
    // PRIVATE INPUTS
    // ================================
    signal input input_secret;        // Secret for input commitment
    signal input input_nullifier;     // Nullifier for input commitment
    signal input input_amount;        // Amount in input commitment
    signal input leaf_index;          // Leaf index in merkle tree
    signal input merkle_path[levels];
    signal input merkle_path_indices[levels];
    
    // Change note private inputs
    signal input change_secret;       // Secret for change commitment
    signal input change_nullifier;    // Nullifier for change commitment
    signal input change_amount;       // Amount in change commitment
    
    // ================================
    // CONSTRAINT: Schema version must be 2
    // ================================
    schema_version === 2;
    
    // ================================
    // CONSTRAINT: Reserved field must be 0
    // ================================
    reserved_0 === 0;
    
    // ================================
    // INPUT COMMITMENT COMPUTATION
    // commitment = Poseidon(secret, nullifier, amount, asset_id)
    // ================================
    component input_commitment_hasher = Poseidon(4);
    input_commitment_hasher.inputs[0] <== input_secret;
    input_commitment_hasher.inputs[1] <== input_nullifier;
    input_commitment_hasher.inputs[2] <== input_amount;
    input_commitment_hasher.inputs[3] <== asset_id;
    
    signal input_commitment;
    input_commitment <== input_commitment_hasher.out;
    
    // ================================
    // NULLIFIER HASH COMPUTATION
    // nullifier_hash = Poseidon(Poseidon(nullifier, secret), leaf_index)
    // ================================
    component nullifier_inner = Poseidon(2);
    nullifier_inner.inputs[0] <== input_nullifier;
    nullifier_inner.inputs[1] <== input_secret;
    
    component nullifier_outer = Poseidon(2);
    nullifier_outer.inputs[0] <== nullifier_inner.out;
    nullifier_outer.inputs[1] <== leaf_index;
    
    // Verify nullifier hash matches public input
    nullifier_outer.out === nullifier_hash_0;
    
    // ================================
    // MERKLE PROOF VERIFICATION
    // ================================
    component merkle_verifier = MerkleTreeChecker(levels);
    merkle_verifier.leaf <== input_commitment;
    merkle_verifier.root <== merkle_root;
    
    for (var i = 0; i < levels; i++) {
        merkle_verifier.pathElements[i] <== merkle_path[i];
        merkle_verifier.pathIndices[i] <== merkle_path_indices[i];
    }
    
    // ================================
    // CHANGE COMMITMENT COMPUTATION
    // change_commitment = Poseidon(change_secret, change_nullifier, change_amount, asset_id)
    // ================================
    component change_commitment_hasher = Poseidon(4);
    change_commitment_hasher.inputs[0] <== change_secret;
    change_commitment_hasher.inputs[1] <== change_nullifier;
    change_commitment_hasher.inputs[2] <== change_amount;
    change_commitment_hasher.inputs[3] <== asset_id;
    
    // Verify change commitment matches public input
    change_commitment_hasher.out === change_commitment;
    
    // ================================
    // VALUE CONSERVATION
    // input_amount = amount + change_amount
    // ================================
    signal sum_outputs;
    sum_outputs <== amount + change_amount;
    sum_outputs === input_amount;
    
    // ================================
    // AMOUNT VALIDATION
    // Ensure withdrawal amount > 0
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
    // CHANGE AMOUNT VALIDATION
    // Ensure change_amount >= 0 (can be zero for full withdrawal)
    // ================================
    component change_check = GreaterEqThan(64);
    change_check.in[0] <== change_amount;
    change_check.in[1] <== 0;
    change_check.out === 1;
    
    // ================================
    // DUMMY CONSTRAINTS FOR PUBLIC INPUTS
    // Ensure all public inputs are constrained
    // ================================
    signal dummy_recipient;
    dummy_recipient <== recipient * recipient;
    
    signal dummy_relayer;
    dummy_relayer <== relayer * relayer;
    
    signal dummy_data_hash;
    dummy_data_hash <== public_data_hash * public_data_hash;
    
    signal dummy_nullifier_1;
    dummy_nullifier_1 <== nullifier_hash_1 * nullifier_hash_1;
}

// Instantiate for depth 20 tree (2^20 = ~1M leaves)
component main {public [
    schema_version,
    merkle_root,
    asset_id,
    nullifier_hash_0,
    nullifier_hash_1,
    change_commitment,
    recipient,
    amount,
    relayer,
    relayer_fee,
    public_data_hash,
    reserved_0
]} = WithdrawV2(20);
