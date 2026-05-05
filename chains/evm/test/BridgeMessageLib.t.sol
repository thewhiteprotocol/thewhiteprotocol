// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/libraries/BridgeMessageLib.sol";

/// @dev Wrapper so library calls happen at a lower depth for expectRevert
contract BridgeMessageLibWrapper {
    function encodeMessage(BridgeMessageLib.BridgeMessageV1 memory message)
        external
        pure
        returns (bytes memory)
    {
        return BridgeMessageLib.encodeMessage(message);
    }

    function hashMessage(BridgeMessageLib.BridgeMessageV1 memory message)
        external
        pure
        returns (bytes32)
    {
        return BridgeMessageLib.hashMessage(message);
    }

    function hashEncodedMessage(bytes memory encoded)
        external
        pure
        returns (bytes32)
    {
        return BridgeMessageLib.hashEncodedMessage(encoded);
    }
}

contract BridgeMessageLibTest is Test {
    using BridgeMessageLib for BridgeMessageLib.BridgeMessageV1;

    BridgeMessageLibWrapper internal wrapper = new BridgeMessageLibWrapper();

    // Golden vector 1: Base Sepolia -> Ethereum Sepolia BridgeOut
    function testVector1_BaseToEth_BridgeOut() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = BridgeMessageLib.BridgeMessageV1({
            protocolVersion: 1,
            messageType: BridgeMessageLib.MESSAGE_TYPE_BRIDGE_OUT,
            sourceDomain: 33554434,
            destinationDomain: 33554435,
            sourceChainId: 84532,
            destinationChainId: 11155111,
            canonicalAssetId: bytes32(uint256(1)),
            sourceLocalAssetId: bytes32(uint256(1)),
            destinationLocalAssetId: bytes32(uint256(1)),
            amount: 1_000_000_000_000_000_000,
            sourceNullifierHash: bytes32(0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef),
            destinationCommitment: bytes32(0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321),
            sourceRoot: bytes32(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa),
            sourceLeafIndex: 7,
            sourceTxHash: bytes32(0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb),
            sourceBlockNumber: 12345678,
            sourceFinalityBlock: 12345688,
            nonce: 1,
            deadline: 1770000000,
            relayerFee: 5_000_000_000_000_000,
            recipientStealthMetadataHash: bytes32(0),
            memoHash: bytes32(0),
            reserved0: bytes32(0),
            reserved1: bytes32(0)
        });

        bytes memory encoded = BridgeMessageLib.encodeMessage(msg_);
        assertEq(encoded.length, BridgeMessageLib.ENCODED_LENGTH, "encoded length");

        bytes32 hash = BridgeMessageLib.hashMessage(msg_);
        assertEq(
            hash,
            0xb4ac9c8ca75af8eb1ff0b31acf18657abffbbc3322a410194eb7815e4b8da464,
            "golden hash vector 1"
        );
    }

    // Golden vector 2: BNB Testnet -> Polygon Amoy BridgeOut
    function testVector2_BnbToPolygon_BridgeOut() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = BridgeMessageLib.BridgeMessageV1({
            protocolVersion: 1,
            messageType: BridgeMessageLib.MESSAGE_TYPE_BRIDGE_OUT,
            sourceDomain: 33554438,
            destinationDomain: 33554436,
            sourceChainId: 97,
            destinationChainId: 80002,
            canonicalAssetId: bytes32(uint256(2)),
            sourceLocalAssetId: bytes32(uint256(2)),
            destinationLocalAssetId: bytes32(uint256(2)),
            amount: 123456789,
            sourceNullifierHash: bytes32(0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef),
            destinationCommitment: bytes32(0xcafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe),
            sourceRoot: bytes32(0x1111111111111111111111111111111111111111111111111111111111111111),
            sourceLeafIndex: 42,
            sourceTxHash: bytes32(0x2222222222222222222222222222222222222222222222222222222222222222),
            sourceBlockNumber: 98765432,
            sourceFinalityBlock: 98765447,
            nonce: 99,
            deadline: 1775000000,
            relayerFee: 1_000_000,
            recipientStealthMetadataHash: bytes32(0),
            memoHash: bytes32(0),
            reserved0: bytes32(0),
            reserved1: bytes32(0)
        });

        bytes memory encoded = BridgeMessageLib.encodeMessage(msg_);
        assertEq(encoded.length, BridgeMessageLib.ENCODED_LENGTH, "encoded length");

        bytes32 hash = BridgeMessageLib.hashMessage(msg_);
        assertEq(
            hash,
            0xddb2b950bbab4f2593fc988f4a477eeb36d57f4a71508f55febb31acbf58d7f4,
            "golden hash vector 2"
        );
    }

    // Golden vector 3: Solana Devnet -> Base Sepolia BridgeOut
    function testVector3_SolanaToBase_BridgeOut() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = BridgeMessageLib.BridgeMessageV1({
            protocolVersion: 1,
            messageType: BridgeMessageLib.MESSAGE_TYPE_BRIDGE_OUT,
            sourceDomain: 33554433,
            destinationDomain: 33554434,
            sourceChainId: 0,
            destinationChainId: 84532,
            canonicalAssetId: bytes32(uint256(1)),
            sourceLocalAssetId: bytes32(uint256(1)),
            destinationLocalAssetId: bytes32(uint256(1)),
            amount: 500_000_000_000_000_000,
            sourceNullifierHash: bytes32(0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd),
            destinationCommitment: bytes32(0x5555555555555555555555555555555555555555555555555555555555555555),
            sourceRoot: bytes32(0x6666666666666666666666666666666666666666666666666666666666666666),
            sourceLeafIndex: 0,
            sourceTxHash: bytes32(0x7777777777777777777777777777777777777777777777777777777777777777),
            sourceBlockNumber: 150000000,
            sourceFinalityBlock: 150000032,
            nonce: 3,
            deadline: 1780000000,
            relayerFee: 2_500_000_000_000_000,
            recipientStealthMetadataHash: bytes32(0x8888888888888888888888888888888888888888888888888888888888888888),
            memoHash: bytes32(0x9999999999999999999999999999999999999999999999999999999999999999),
            reserved0: bytes32(0),
            reserved1: bytes32(0)
        });

        bytes memory encoded = BridgeMessageLib.encodeMessage(msg_);
        assertEq(encoded.length, BridgeMessageLib.ENCODED_LENGTH, "encoded length");

        bytes32 hash = BridgeMessageLib.hashMessage(msg_);
        assertEq(
            hash,
            0x8c0c22e9417df1a7c3a570afde1679472a406d67f8cf4a043cd445ce67eed344,
            "golden hash vector 3"
        );
    }

    // Golden vector 4: Ethereum Sepolia -> Base Sepolia BridgeMint
    function testVector4_EthToBase_BridgeMint() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = BridgeMessageLib.BridgeMessageV1({
            protocolVersion: 1,
            messageType: BridgeMessageLib.MESSAGE_TYPE_BRIDGE_MINT,
            sourceDomain: 33554435,
            destinationDomain: 33554434,
            sourceChainId: 11155111,
            destinationChainId: 84532,
            canonicalAssetId: bytes32(uint256(3)),
            sourceLocalAssetId: bytes32(uint256(3)),
            destinationLocalAssetId: bytes32(uint256(3)),
            amount: 10_000_000_000_000_000_000,
            sourceNullifierHash: bytes32(0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20),
            destinationCommitment: bytes32(0x202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f),
            sourceRoot: bytes32(0x404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f),
            sourceLeafIndex: 100,
            sourceTxHash: bytes32(0x606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f),
            sourceBlockNumber: 5555555,
            sourceFinalityBlock: 5555567,
            nonce: 42,
            deadline: 1785000000,
            relayerFee: 10_000_000_000_000_000,
            recipientStealthMetadataHash: bytes32(0),
            memoHash: bytes32(0),
            reserved0: bytes32(0),
            reserved1: bytes32(0)
        });

        bytes memory encoded = BridgeMessageLib.encodeMessage(msg_);
        assertEq(encoded.length, BridgeMessageLib.ENCODED_LENGTH, "encoded length");

        bytes32 hash = BridgeMessageLib.hashMessage(msg_);
        assertEq(
            hash,
            0xbfc85db07abe8b9e72838726899619013a18e2580f3d1ee3e688323a41e406e7,
            "golden hash vector 4"
        );
    }

    // Cross-language parity: compute hash and compare to known TypeScript hash
    function testCrossLanguageParity_Vector1() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();

        bytes memory encoded = BridgeMessageLib.encodeMessage(msg_);
        bytes32 hash = BridgeMessageLib.hashMessage(msg_);
        bytes32 hash2 = BridgeMessageLib.hashEncodedMessage(encoded);

        assertEq(hash, hash2, "hashMessage == hashEncodedMessage");
        assertEq(
            hash,
            0xb4ac9c8ca75af8eb1ff0b31acf18657abffbbc3322a410194eb7815e4b8da464,
            "cross-language parity with TypeScript/Rust"
        );
    }

    // Validation tests
    function testRejectsInvalidProtocolVersion() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.protocolVersion = 2;

        vm.expectRevert(
            abi.encodeWithSelector(
                BridgeMessageLib.InvalidProtocolVersion.selector,
                2,
                1
            )
        );
        wrapper.encodeMessage(msg_);
    }

    function testRejectsInvalidMessageType() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.messageType = 99;

        vm.expectRevert(
            abi.encodeWithSelector(BridgeMessageLib.InvalidMessageType.selector, 99)
        );
        wrapper.encodeMessage(msg_);
    }

    function testRejectsZeroSourceDomain() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.sourceDomain = 0;

        vm.expectRevert(
            abi.encodeWithSelector(BridgeMessageLib.ZeroDomain.selector, "sourceDomain")
        );
        wrapper.encodeMessage(msg_);
    }

    function testRejectsZeroDestinationDomain() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.destinationDomain = 0;

        vm.expectRevert(
            abi.encodeWithSelector(BridgeMessageLib.ZeroDomain.selector, "destinationDomain")
        );
        wrapper.encodeMessage(msg_);
    }

    function testRejectsSameDomain() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.destinationDomain = msg_.sourceDomain;

        vm.expectRevert(BridgeMessageLib.SameDomain.selector);
        wrapper.encodeMessage(msg_);
    }

    function testRejectsZeroAmount() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.amount = 0;

        vm.expectRevert(BridgeMessageLib.ZeroAmount.selector);
        wrapper.encodeMessage(msg_);
    }

    function testRejectsZeroDeadline() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.deadline = 0;

        vm.expectRevert(BridgeMessageLib.ZeroDeadline.selector);
        wrapper.encodeMessage(msg_);
    }

    function testRejectsZeroCanonicalAssetId() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.canonicalAssetId = bytes32(0);

        vm.expectRevert(BridgeMessageLib.ZeroCanonicalAssetId.selector);
        wrapper.encodeMessage(msg_);
    }

    function testRejectsZeroDestinationCommitmentForBridgeOut() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.destinationCommitment = bytes32(0);

        vm.expectRevert(BridgeMessageLib.ZeroDestinationCommitment.selector);
        wrapper.encodeMessage(msg_);
    }

    function testRejectsZeroNullifierForBridgeOut() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.sourceNullifierHash = bytes32(0);

        vm.expectRevert(BridgeMessageLib.ZeroSourceNullifierHash.selector);
        wrapper.encodeMessage(msg_);
    }

    function testAllowsBridgeMintWithZeroCommitment() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.messageType = BridgeMessageLib.MESSAGE_TYPE_BRIDGE_MINT;
        msg_.destinationCommitment = bytes32(0);
        msg_.sourceNullifierHash = bytes32(0);

        // Should not revert
        bytes memory encoded = BridgeMessageLib.encodeMessage(msg_);
        assertEq(encoded.length, BridgeMessageLib.ENCODED_LENGTH);
    }

    function testRejectsInvalidFinalityBlock() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.sourceFinalityBlock = msg_.sourceBlockNumber - 1;

        vm.expectRevert(BridgeMessageLib.InvalidFinalityBlock.selector);
        wrapper.encodeMessage(msg_);
    }

    function testDeterministicEncoding() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();

        bytes memory e1 = BridgeMessageLib.encodeMessage(msg_);
        bytes memory e2 = BridgeMessageLib.encodeMessage(msg_);

        assertEq(keccak256(e1), keccak256(e2), "encoding deterministic");
    }

    function testDeterministicHash() public pure {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();

        bytes32 h1 = BridgeMessageLib.hashMessage(msg_);
        bytes32 h2 = BridgeMessageLib.hashMessage(msg_);

        assertEq(h1, h2, "hash deterministic");
    }

    // Helpers
    function _makeValidMessage()
        private
        pure
        returns (BridgeMessageLib.BridgeMessageV1 memory)
    {
        return BridgeMessageLib.BridgeMessageV1({
            protocolVersion: 1,
            messageType: BridgeMessageLib.MESSAGE_TYPE_BRIDGE_OUT,
            sourceDomain: 33554434,
            destinationDomain: 33554435,
            sourceChainId: 84532,
            destinationChainId: 11155111,
            canonicalAssetId: bytes32(uint256(1)),
            sourceLocalAssetId: bytes32(uint256(1)),
            destinationLocalAssetId: bytes32(uint256(1)),
            amount: 1_000_000_000_000_000_000,
            sourceNullifierHash: bytes32(0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef),
            destinationCommitment: bytes32(0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321),
            sourceRoot: bytes32(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa),
            sourceLeafIndex: 7,
            sourceTxHash: bytes32(0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb),
            sourceBlockNumber: 12345678,
            sourceFinalityBlock: 12345688,
            nonce: 1,
            deadline: 1770000000,
            relayerFee: 5_000_000_000_000_000,
            recipientStealthMetadataHash: bytes32(0),
            memoHash: bytes32(0),
            reserved0: bytes32(0),
            reserved1: bytes32(0)
        });
    }
}
