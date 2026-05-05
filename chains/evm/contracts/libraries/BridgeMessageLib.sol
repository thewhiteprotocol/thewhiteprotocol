// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BridgeMessageLib
 * @notice Canonical encoding and hashing for The White Protocol private bridge messages.
 *
 * Cross-language parity: Solidity, TypeScript, and Rust must all produce
 * identical keccak256 hashes for the same message inputs.
 *
 * Encoding rules:
 * - All integers are big-endian.
 * - bytes32 fields are raw 32 bytes.
 * - No dynamic-length fields.
 * - Fixed total encoded length: 451 bytes.
 * - Hash: keccak256(domainSeparator || encodedMessage)
 */
library BridgeMessageLib {
    // =========================================================================
    // CONSTANTS
    // =========================================================================

    uint16 public constant PROTOCOL_VERSION = 1;
    uint8 public constant MESSAGE_TYPE_BRIDGE_OUT = 1;
    uint8 public constant MESSAGE_TYPE_BRIDGE_MINT = 2;

    /// @dev Exact ASCII domain separator bytes — consensus-critical
    /// Note: This is the RAW string bytes, NOT its keccak256 hash.
    bytes public constant DOMAIN_SEPARATOR = bytes("WHITE_PRIVATE_BRIDGE_MESSAGE_V1");

    /// @dev Fixed encoded message length in bytes
    uint256 public constant ENCODED_LENGTH = 451;

    // =========================================================================
    // ERRORS
    // =========================================================================

    error InvalidProtocolVersion(uint16 got, uint16 expected);
    error InvalidMessageType(uint8 got);
    error ZeroDomain(string field);
    error SameDomain();
    error ZeroAmount();
    error ZeroDeadline();
    error ZeroCanonicalAssetId();
    error ZeroDestinationCommitment();
    error ZeroSourceNullifierHash();
    error InvalidFinalityBlock();
    error Uint128Overflow(string field);

    // =========================================================================
    // STRUCTS
    // =========================================================================

    struct BridgeMessageV1 {
        uint16 protocolVersion;
        uint8 messageType;
        uint32 sourceDomain;
        uint32 destinationDomain;
        uint64 sourceChainId;
        uint64 destinationChainId;
        bytes32 canonicalAssetId;
        bytes32 sourceLocalAssetId;
        bytes32 destinationLocalAssetId;
        uint128 amount;
        bytes32 sourceNullifierHash;
        bytes32 destinationCommitment;
        bytes32 sourceRoot;
        uint64 sourceLeafIndex;
        bytes32 sourceTxHash;
        uint64 sourceBlockNumber;
        uint64 sourceFinalityBlock;
        uint64 nonce;
        uint64 deadline;
        uint128 relayerFee;
        bytes32 recipientStealthMetadataHash;
        bytes32 memoHash;
        bytes32 reserved0;
        bytes32 reserved1;
    }

    // =========================================================================
    // ENCODING
    // =========================================================================

    /**
     * @notice Encode a BridgeMessageV1 into a fixed-length bytes array (451 bytes).
     * @dev Reverts on validation failure.
     */
    function encodeMessage(BridgeMessageV1 memory message)
        internal
        pure
        returns (bytes memory)
    {
        validateMessage(message);

        bytes memory out = new bytes(ENCODED_LENGTH);
        uint256 p = 0;

        // uint16 protocolVersion
        out[p++] = bytes1(uint8(message.protocolVersion >> 8));
        out[p++] = bytes1(uint8(message.protocolVersion));

        // uint8 messageType
        out[p++] = bytes1(message.messageType);

        // uint32 sourceDomain
        out[p++] = bytes1(uint8(message.sourceDomain >> 24));
        out[p++] = bytes1(uint8(message.sourceDomain >> 16));
        out[p++] = bytes1(uint8(message.sourceDomain >> 8));
        out[p++] = bytes1(uint8(message.sourceDomain));

        // uint32 destinationDomain
        out[p++] = bytes1(uint8(message.destinationDomain >> 24));
        out[p++] = bytes1(uint8(message.destinationDomain >> 16));
        out[p++] = bytes1(uint8(message.destinationDomain >> 8));
        out[p++] = bytes1(uint8(message.destinationDomain));

        // uint64 sourceChainId
        _writeUint64(out, p, message.sourceChainId);
        p += 8;

        // uint64 destinationChainId
        _writeUint64(out, p, message.destinationChainId);
        p += 8;

        // bytes32 fields
        _writeBytes32(out, p, message.canonicalAssetId);
        p += 32;
        _writeBytes32(out, p, message.sourceLocalAssetId);
        p += 32;
        _writeBytes32(out, p, message.destinationLocalAssetId);
        p += 32;

        // uint128 amount
        _writeUint128(out, p, message.amount);
        p += 16;

        _writeBytes32(out, p, message.sourceNullifierHash);
        p += 32;
        _writeBytes32(out, p, message.destinationCommitment);
        p += 32;
        _writeBytes32(out, p, message.sourceRoot);
        p += 32;

        // uint64 sourceLeafIndex
        _writeUint64(out, p, message.sourceLeafIndex);
        p += 8;

        _writeBytes32(out, p, message.sourceTxHash);
        p += 32;

        // uint64 sourceBlockNumber
        _writeUint64(out, p, message.sourceBlockNumber);
        p += 8;

        // uint64 sourceFinalityBlock
        _writeUint64(out, p, message.sourceFinalityBlock);
        p += 8;

        // uint64 nonce
        _writeUint64(out, p, message.nonce);
        p += 8;

        // uint64 deadline
        _writeUint64(out, p, message.deadline);
        p += 8;

        // uint128 relayerFee
        _writeUint128(out, p, message.relayerFee);
        p += 16;

        _writeBytes32(out, p, message.recipientStealthMetadataHash);
        p += 32;
        _writeBytes32(out, p, message.memoHash);
        p += 32;
        _writeBytes32(out, p, message.reserved0);
        p += 32;
        _writeBytes32(out, p, message.reserved1);
        p += 32;

        require(p == ENCODED_LENGTH, "Encoding length mismatch");
        return out;
    }

    // =========================================================================
    // HASHING
    // =========================================================================

    /**
     * @notice Compute the canonical keccak256 hash of a BridgeMessageV1.
     * @dev Hash = keccak256(domainSeparator || encodedMessage)
     */
    function hashMessage(BridgeMessageV1 memory message)
        internal
        pure
        returns (bytes32)
    {
        bytes memory encoded = encodeMessage(message);
        return keccak256(abi.encodePacked(DOMAIN_SEPARATOR, encoded));
    }

    /**
     * @notice Hash an already-encoded message buffer.
     */
    function hashEncodedMessage(bytes memory encoded)
        internal
        pure
        returns (bytes32)
    {
        require(encoded.length == ENCODED_LENGTH, "Invalid encoded length");
        return keccak256(abi.encodePacked(DOMAIN_SEPARATOR, encoded));
    }

    // =========================================================================
    // VALIDATION
    // =========================================================================

    function validateMessage(BridgeMessageV1 memory message)
        internal
        pure
    {
        if (message.protocolVersion != PROTOCOL_VERSION) {
            revert InvalidProtocolVersion(
                message.protocolVersion,
                PROTOCOL_VERSION
            );
        }

        if (
            message.messageType != MESSAGE_TYPE_BRIDGE_OUT &&
            message.messageType != MESSAGE_TYPE_BRIDGE_MINT
        ) {
            revert InvalidMessageType(message.messageType);
        }

        if (message.sourceDomain == 0) {
            revert ZeroDomain("sourceDomain");
        }

        if (message.destinationDomain == 0) {
            revert ZeroDomain("destinationDomain");
        }

        if (message.sourceDomain == message.destinationDomain) {
            revert SameDomain();
        }

        if (message.amount == 0) {
            revert ZeroAmount();
        }

        if (message.deadline == 0) {
            revert ZeroDeadline();
        }

        if (message.canonicalAssetId == bytes32(0)) {
            revert ZeroCanonicalAssetId();
        }

        if (
            message.messageType == MESSAGE_TYPE_BRIDGE_OUT &&
            message.destinationCommitment == bytes32(0)
        ) {
            revert ZeroDestinationCommitment();
        }

        if (
            message.messageType == MESSAGE_TYPE_BRIDGE_OUT &&
            message.sourceNullifierHash == bytes32(0)
        ) {
            revert ZeroSourceNullifierHash();
        }

        if (message.sourceFinalityBlock < message.sourceBlockNumber) {
            revert InvalidFinalityBlock();
        }
    }

    // =========================================================================
    // HELPERS
    // =========================================================================

    function _writeUint64(
        bytes memory out,
        uint256 offset,
        uint64 value
    ) private pure {
        for (uint256 i = 0; i < 8; i++) {
            out[offset + i] = bytes1(uint8(value >> (56 - i * 8)));
        }
    }

    function _writeUint128(
        bytes memory out,
        uint256 offset,
        uint128 value
    ) private pure {
        for (uint256 i = 0; i < 16; i++) {
            out[offset + i] = bytes1(uint8(value >> (120 - i * 8)));
        }
    }

    function _writeBytes32(
        bytes memory out,
        uint256 offset,
        bytes32 value
    ) private pure {
        assembly {
            mstore(add(add(out, 32), offset), value)
        }
    }
}
