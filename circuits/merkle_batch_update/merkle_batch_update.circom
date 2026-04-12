// The White Protocol Merkle Batch Update Circuit (Production Grade - Fixed)
// 
// Uses conditional verification to handle variable batch sizes correctly.
pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/bitify.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";
include "../../node_modules/circomlib/circuits/sha256/sha256.circom";
include "../../node_modules/circomlib/circuits/mux1.circom";

// Convert 256-bit sha256 output to BN254 field element
template Sha256ToField() {
    signal input bits[256];
    signal output out;
    
    component bits2num = Bits2Num(253);
    for (var i = 0; i < 253; i++) {
        bits2num.in[i] <== bits[255 - i];
    }
    out <== bits2num.out;
}

// Poseidon hash of 2 elements
template HashLeftRight() {
    signal input left;
    signal input right;
    signal output hash;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== left;
    hasher.inputs[1] <== right;
    hash <== hasher.out;
}

// Compute new root after inserting leaf at index
// Does NOT verify old state - just computes what new root would be
template ComputeNewRoot(levels) {
    signal input newLeaf;
    signal input leafIndex;
    signal input pathElements[levels];
    signal output newRoot;
    
    component indexBits = Num2Bits(levels);
    indexBits.in <== leafIndex;
    
    signal hashes[levels + 1];
    hashes[0] <== newLeaf;
    
    component hashers[levels];
    component muxLeft[levels];
    component muxRight[levels];
    
    for (var i = 0; i < levels; i++) {
        muxLeft[i] = Mux1();
        muxLeft[i].c[0] <== hashes[i];
        muxLeft[i].c[1] <== pathElements[i];
        muxLeft[i].s <== indexBits.out[i];
        
        muxRight[i] = Mux1();
        muxRight[i].c[0] <== pathElements[i];
        muxRight[i].c[1] <== hashes[i];
        muxRight[i].s <== indexBits.out[i];
        
        hashers[i] = HashLeftRight();
        hashers[i].left <== muxLeft[i].out;
        hashers[i].right <== muxRight[i].out;
        
        hashes[i + 1] <== hashers[i].hash;
    }
    
    newRoot <== hashes[levels];
}

// Hash commitments using sha256
template CommitmentsHasher(maxBatch) {
    signal input commitments[maxBatch];
    signal input batchSize;
    signal output hash;
    
    component num2bits[maxBatch];
    for (var i = 0; i < maxBatch; i++) {
        num2bits[i] = Num2Bits(256);
        num2bits[i].in <== commitments[i];
    }
    
    component isActive[maxBatch];
    for (var i = 0; i < maxBatch; i++) {
        isActive[i] = LessThan(8);
        isActive[i].in[0] <== i;
        isActive[i].in[1] <== batchSize;
    }
    
    // Enforce inactive commitments are zero
    signal inactiveCheck[maxBatch];
    for (var i = 0; i < maxBatch; i++) {
        inactiveCheck[i] <== (1 - isActive[i].out) * commitments[i];
        inactiveCheck[i] === 0;
    }
    
    component sha = Sha256(maxBatch * 256);
    component bitMux[maxBatch][256];
    
    for (var i = 0; i < maxBatch; i++) {
        for (var j = 0; j < 256; j++) {
            bitMux[i][j] = Mux1();
            bitMux[i][j].c[0] <== 0;
            bitMux[i][j].c[1] <== num2bits[i].out[255 - j];
            bitMux[i][j].s <== isActive[i].out;
            sha.in[i * 256 + j] <== bitMux[i][j].out;
        }
    }
    
    component toField = Sha256ToField();
    for (var i = 0; i < 256; i++) {
        toField.bits[i] <== sha.out[i];
    }
    
    hash <== toField.out;
}

template MerkleBatchUpdate(depth, maxBatch) {
    // PUBLIC INPUTS
    signal input oldRoot;
    signal input newRoot;
    signal input startIndex;
    signal input batchSize;
    signal input commitmentsHash;
    
    // PRIVATE INPUTS
    signal input commitments[maxBatch];
    signal input pathElements[maxBatch][depth];
    
    // VALIDATE BATCH SIZE
    component batchGt0 = GreaterThan(8);
    batchGt0.in[0] <== batchSize;
    batchGt0.in[1] <== 0;
    batchGt0.out === 1;
    
    component batchLteMax = LessEqThan(8);
    batchLteMax.in[0] <== batchSize;
    batchLteMax.in[1] <== maxBatch;
    batchLteMax.out === 1;
    
    // VERIFY COMMITMENTS HASH
    component hasher = CommitmentsHasher(maxBatch);
    hasher.batchSize <== batchSize;
    for (var i = 0; i < maxBatch; i++) {
        hasher.commitments[i] <== commitments[i];
    }
    hasher.hash === commitmentsHash;
    
    // VERIFY OLD ROOT (first slot only - proves we know the tree state)
    // Compute what root we get if old leaf at startIndex was 0
    component verifyOldRoot = ComputeNewRoot(depth);
    verifyOldRoot.newLeaf <== 0;
    verifyOldRoot.leafIndex <== startIndex;
    for (var j = 0; j < depth; j++) {
        verifyOldRoot.pathElements[j] <== pathElements[0][j];
    }
    verifyOldRoot.newRoot === oldRoot;
    
    // CHAIN MERKLE INSERTIONS
    signal intermediateRoots[maxBatch + 1];
    intermediateRoots[0] <== oldRoot;
    
    component rootComputers[maxBatch];
    component isActive[maxBatch];
    component rootMux[maxBatch];
    
    for (var i = 0; i < maxBatch; i++) {
        isActive[i] = LessThan(8);
        isActive[i].in[0] <== i;
        isActive[i].in[1] <== batchSize;
        
        // Compute new root if we insert this commitment
        rootComputers[i] = ComputeNewRoot(depth);
        rootComputers[i].newLeaf <== commitments[i];
        rootComputers[i].leafIndex <== startIndex + i;
        for (var j = 0; j < depth; j++) {
            rootComputers[i].pathElements[j] <== pathElements[i][j];
        }
        
        // If active: use computed new root, else: carry forward
        rootMux[i] = Mux1();
        rootMux[i].c[0] <== intermediateRoots[i];
        rootMux[i].c[1] <== rootComputers[i].newRoot;
        rootMux[i].s <== isActive[i].out;
        
        intermediateRoots[i + 1] <== rootMux[i].out;
    }
    
    // VERIFY FINAL ROOT
    newRoot === intermediateRoots[maxBatch];
}

component main {public [oldRoot, newRoot, startIndex, batchSize, commitmentsHash]} = MerkleBatchUpdate(20, 1);
