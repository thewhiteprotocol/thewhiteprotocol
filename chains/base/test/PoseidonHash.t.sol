// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/PoseidonHasher.sol";
import "../contracts/MerkleTreeWithHistory.sol";

/**
 * @title PoseidonHashTest
 * @notice Tests to verify Poseidon implementation matches circomlib
 * @dev Expected values come from tools/poseidon-vectors/vectors.json
 */
contract PoseidonHashTest is Test {
    PoseidonHasher hasher;
    MerkleTreeWithHistory merkleTree;
    
    // Expected value for poseidon(0, 0) from circomlib
    // From vectors.json: "0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864"
    uint256 constant EXPECTED_POSEIDON_0_0 = 0x2098f5fb9e239eab3ceac3f27b81e481dc3124d55ffed523a839ee8446b64864;
    
    // Expected value for poseidon(1, 2) from circomlib
    // From vectors.json: "0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a"
    uint256 constant EXPECTED_POSEIDON_1_2 = 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a;
    
    function setUp() public {
        hasher = new PoseidonHasher();
        merkleTree = new MerkleTreeWithHistory();
    }
    
    /**
     * @notice Test poseidon(0, 0) matches circomlib output
     */
    function testPoseidonZeroZero() public view {
        uint256[2] memory input = [uint256(0), uint256(0)];
        uint256 result = hasher.poseidon(input);
        
        assertEq(
            result, 
            EXPECTED_POSEIDON_0_0, 
            "poseidon(0,0) should match circomlib"
        );
    }
    
    /**
     * @notice Test poseidon(0, 0) using convenience method
     */
    function testPoseidonZeroZeroConvenience() public view {
        uint256 result = hasher.poseidon(0, 0);
        
        assertEq(
            result, 
            EXPECTED_POSEIDON_0_0, 
            "poseidon(0,0) convenience method should match circomlib"
        );
    }
    
    /**
     * @notice Test poseidon(1, 2) matches circomlib output
     */
    function testPoseidonOneTwo() public view {
        uint256[2] memory input = [uint256(1), uint256(2)];
        uint256 result = hasher.poseidon(input);
        
        assertEq(
            result, 
            EXPECTED_POSEIDON_1_2, 
            "poseidon(1,2) should match circomlib"
        );
    }
    
    /**
     * @notice Test that MerkleTree zeros match expected values
     */
    function testMerkleTreeZeros() public view {
        // zeros(1) should equal poseidon(0,0)
        assertEq(
            merkleTree.zeros(1),
            EXPECTED_POSEIDON_0_0,
            "zeros(1) should equal poseidon(0,0)"
        );
    }
    
    /**
     * @notice Test initial root of empty Merkle tree
     */
    function testEmptyTreeRoot() public view {
        uint256 initialRoot = merkleTree.getLastRoot();
        
        // The initial root should be zeros(20)
        assertEq(
            initialRoot,
            merkleTree.zeros(20),
            "Initial root should be zeros(20)"
        );
        
        // Verify zeros(20) is non-zero
        assertTrue(initialRoot != 0, "Initial root should not be zero");
    }
    
    /**
     * @notice Test hashLeftRight in MerkleTreeWithHistory
     */
    function testHashLeftRight() public view {
        uint256 result = merkleTree.hashLeftRight(0, 0);
        
        assertEq(
            result,
            EXPECTED_POSEIDON_0_0,
            "hashLeftRight(0,0) should match expected"
        );
    }
    
    /**
     * @notice Test that different inputs produce different outputs
     */
    function testDifferentInputs() public view {
        uint256 result1 = hasher.poseidon(0, 0);
        uint256 result2 = hasher.poseidon(0, 1);
        uint256 result3 = hasher.poseidon(1, 0);
        
        assertTrue(result1 != result2, "Different inputs should produce different outputs");
        assertTrue(result1 != result3, "Different inputs should produce different outputs");
        assertTrue(result2 != result3, "Different inputs should produce different outputs");
    }
    
    /**
     * @notice Test round-trip consistency (same inputs = same outputs)
     */
    function testConsistency() public view {
        uint256 result1 = hasher.poseidon(123, 456);
        uint256 result2 = hasher.poseidon(123, 456);
        
        assertEq(result1, result2, "Same inputs should produce same outputs");
    }
}
