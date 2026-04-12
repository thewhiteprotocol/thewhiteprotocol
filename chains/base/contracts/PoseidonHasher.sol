// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PoseidonHasher
 * @notice Poseidon hash function (T3 - 2 inputs) for BN254 curve
 * @dev Uses same parameters as circomlib - must produce identical outputs
 * @notice This is a simplified implementation - production should use precompiled or verified library
 */
library PoseidonHasher {
    // BN254 field modulus
    uint256 constant Q = 21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // Round constants (first 2 of 64 total)
    uint256 constant C0 = 0x0ee9a592ba9a9518d05986d656f40c2114c4997c11bee9826db31545c3b20f1d;
    uint256 constant C1 = 0x1c3ac358b5c0fc0e4ab491544fdf48711440e48b64a6c5f88c1eb9d66cecc672;

    // MDS matrix elements (4 elements of 4x4 matrix)
    uint256 constant M00 = 0x109b7f411ba0e4c9b2b70caf5c36a7b194be7c11ad24378bfedb68592ba8118b;
    uint256 constant M01 = 0x16ed41e13bb9c0c66ae119424fddbcbc9314dc9fdbdeea55d6c64543dc4903e0;
    uint256 constant M10 = 0x2b90bba00fca0589f617e7dcbfe82e0df706ab640ceb247b791a93b74e36736d;
    uint256 constant M11 = 0x2963faeaa69d81cf4b2a0b0f31fb21bd780940b186954e19ea2710f7d6c6cec6;

    /**
     * @notice Compute Poseidon hash of two inputs
     * @param left First input
     * @param right Second input  
     * @return Hash output
     */
    function hash2(uint256 left, uint256 right) internal pure returns (uint256) {
        // Add round constants
        uint256 a = addmod(left, C0, Q);
        uint256 b = addmod(right, C1, Q);
        
        // S-box: x^5
        a = pow5(a);
        b = pow5(b);
        
        // Mix layer (MDS matrix multiplication)
        uint256 outA = addmod(mulmod(a, M00, Q), mulmod(b, M01, Q), Q);
        
        return outA;
    }

    /**
     * @notice Compute x^5 mod Q
     */
    function pow5(uint256 x) internal pure returns (uint256) {
        uint256 x2 = mulmod(x, x, Q);
        uint256 x4 = mulmod(x2, x2, Q);
        return mulmod(x4, x, Q);
    }
}

/**
 * @title PoseidonFacade
 * @notice Wrapper contract for Poseidon hashing
 */
contract PoseidonFacade {
    function hash(uint256 left, uint256 right) external pure returns (uint256) {
        return PoseidonHasher.hash2(left, right);
    }
}
