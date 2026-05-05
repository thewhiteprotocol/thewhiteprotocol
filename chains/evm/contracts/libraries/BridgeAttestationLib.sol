// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title BridgeAttestationLib
 * @notice Threshold ECDSA signature verification for bridge message attestations.
 *
 * Cross-chain compatibility: uses raw message hash (no EIP-191 prefix) so that
 * Solana secp256k1_recover can verify the same signatures.
 *
 * Signatures must be sorted by recovered signer address (ascending) to prevent
 * duplicate-signer attacks.
 */
library BridgeAttestationLib {
    using ECDSA for bytes32;

    // =========================================================================
    // Structs
    // =========================================================================

    struct SignerSet {
        address[] signers;
        uint256 threshold;
        uint256 version;
    }

    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidThreshold();
    error ZeroSigner();
    error DuplicateSigner();
    error ThresholdNotMet();
    error InvalidSignature();
    error SignaturesNotSorted();
    error InvalidSigner();
    error EmptySignerSet();

    // =========================================================================
    // Verification
    // =========================================================================

    /**
     * @notice Verify a threshold of valid ECDSA signatures over a raw message hash.
     * @param messageHash The 32-byte keccak256 hash that was signed.
     * @param signatures Array of 65-byte ECDSA signatures (r, s, v).
     * @param signerSet The signer set containing allowed addresses and threshold.
     * @return validCount The number of valid signatures from distinct allowed signers.
     */
    function verifyThresholdSignatures(
        bytes32 messageHash,
        bytes[] memory signatures,
        SignerSet memory signerSet
    ) internal pure returns (uint256 validCount) {
        if (signerSet.signers.length == 0) revert EmptySignerSet();
        if (signerSet.threshold == 0) revert InvalidThreshold();
        if (signerSet.threshold > signerSet.signers.length) revert InvalidThreshold();
        if (signatures.length < signerSet.threshold) revert ThresholdNotMet();

        address lastSigner = address(0);
        validCount = 0;

        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = messageHash.recover(signatures[i]);

            if (signer == address(0)) revert InvalidSignature();
            if (signer <= lastSigner) revert SignaturesNotSorted();
            if (!_isSigner(signer, signerSet.signers)) revert InvalidSigner();

            lastSigner = signer;
            validCount++;

            if (validCount >= signerSet.threshold) {
                // Early exit once threshold is reached
                return validCount;
            }
        }

        revert ThresholdNotMet();
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * @notice Check if an address is in the signer list.
     */
    function _isSigner(address account, address[] memory signers)
        private
        pure
        returns (bool)
    {
        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == account) return true;
        }
        return false;
    }

    /**
     * @notice Validate a signer set configuration. Reverts on invalid input.
     */
    function validateSignerSet(address[] memory signers, uint256 threshold)
        internal
        pure
    {
        if (signers.length == 0) revert EmptySignerSet();
        if (threshold == 0) revert InvalidThreshold();
        if (threshold > signers.length) revert InvalidThreshold();

        for (uint256 i = 0; i < signers.length; i++) {
            if (signers[i] == address(0)) revert ZeroSigner();
            for (uint256 j = i + 1; j < signers.length; j++) {
                if (signers[i] == signers[j]) revert DuplicateSigner();
            }
        }
    }
}
