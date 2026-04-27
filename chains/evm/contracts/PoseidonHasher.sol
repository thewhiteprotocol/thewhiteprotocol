// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "poseidon-solidity/PoseidonT3.sol";

/**
 * @title PoseidonHasher
 * @notice Wrapper contract for PoseidonT3 (2-input Poseidon hash)
 * @dev Uses chancehudson/poseidon-solidity library which matches circomlib's Poseidon
 */
contract PoseidonHasher {
    
    /**
     * @notice Computes Poseidon hash of two inputs
     * @param input Array of 2 uint256 values
     * @return uint256 hash result
     */
    function poseidon(uint256[2] calldata input) external pure returns (uint256) {
        return PoseidonT3.hash(input);
    }
    
    /**
     * @notice Computes Poseidon hash of two inputs (convenience method)
     * @param left Left input
     * @param right Right input
     * @return uint256 hash result
     */
    function poseidon(uint256 left, uint256 right) external pure returns (uint256) {
        uint256[2] memory input = [left, right];
        return PoseidonT3.hash(input);
    }
}
