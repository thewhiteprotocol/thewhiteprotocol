// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/BridgeInbox.sol";
import "../contracts/WhiteProtocol.sol";
import "../contracts/AssetRegistry.sol";
import "../contracts/libraries/BridgeMessageLib.sol";

// Mock verifiers that always return true
contract MockDepositVerifier {
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[3] calldata) external pure returns (bool) { return true; }
}

contract MockWithdrawVerifier {
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[8] calldata) external pure returns (bool) { return true; }
}

contract MockMerkleBatchVerifier {
    function verifyProof(uint256[2] calldata, uint256[2][2] calldata, uint256[2] calldata, uint256[5] calldata) external pure returns (bool) { return true; }
}

contract BridgeInboxTest is Test {
    // Local event for expectEmit
    event BridgeMintAccepted(
        bytes32 indexed messageHash,
        bytes32 indexed destinationCommitment,
        bytes32 indexed canonicalAssetId,
        uint128 amount,
        uint64 nonce
    );

    BridgeInbox public inbox;
    WhiteProtocol public whiteProtocol;
    AssetRegistry public assetRegistry;
    MockDepositVerifier public depositVerifier;
    MockWithdrawVerifier public withdrawVerifier;
    MockMerkleBatchVerifier public merkleBatchVerifier;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    uint32 constant LOCAL_DOMAIN = 33554435; // Ethereum Sepolia
    uint32 constant SRC_DOMAIN = 33554434;   // Base Sepolia

    bytes32 constant ASSET_ID = bytes32(uint256(1));
    address constant LOCAL_ASSET = address(0); // ETH

    // Signer keys
    uint256 signer1Key = 0xaaa;
    uint256 signer2Key = 0xbbb;
    uint256 signer3Key = 0xccc;
    uint256 attackerKey = 0xddd;

    address signer1;
    address signer2;
    address signer3;
    address attacker;

    function setUp() public {
        signer1 = vm.addr(signer1Key);
        signer2 = vm.addr(signer2Key);
        signer3 = vm.addr(signer3Key);
        attacker = vm.addr(attackerKey);

        // Deploy WhiteProtocol with mock verifiers
        vm.startPrank(owner);
        depositVerifier = new MockDepositVerifier();
        withdrawVerifier = new MockWithdrawVerifier();
        merkleBatchVerifier = new MockMerkleBatchVerifier();
        assetRegistry = new AssetRegistry(owner);
        whiteProtocol = new WhiteProtocol(
            owner,
            address(depositVerifier),
            address(withdrawVerifier),
            address(merkleBatchVerifier),
            address(assetRegistry)
        );
        assetRegistry.addAsset(LOCAL_ASSET, false, 18, 0.001 ether, 1000 ether);

        // Deploy BridgeInbox
        inbox = new BridgeInbox(owner, LOCAL_DOMAIN);

        // Wire BridgeInbox to WhiteProtocol
        inbox.setWhiteProtocol(address(whiteProtocol));
        whiteProtocol.setBridge(address(inbox));
        inbox.setLocalAsset(ASSET_ID, LOCAL_ASSET);

        // Setup signer set (2-of-3)
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;
        inbox.updateSignerSet(signers, 2);

        // Enable route and asset
        inbox.enableRoute(SRC_DOMAIN);
        inbox.supportAsset(ASSET_ID);
        inbox.setMaxMessageAmount(ASSET_ID, 10 ether);
        inbox.setDailyInflowCap(ASSET_ID, 100 ether);
        inbox.setGlobalDailyCap(500 ether);
        vm.stopPrank();
    }

    function _makeValidMessage() internal view returns (BridgeMessageLib.BridgeMessageV1 memory) {
        return BridgeMessageLib.BridgeMessageV1({
            protocolVersion: 1,
            messageType: BridgeMessageLib.MESSAGE_TYPE_BRIDGE_MINT,
            sourceDomain: SRC_DOMAIN,
            destinationDomain: LOCAL_DOMAIN,
            sourceChainId: 84532,
            destinationChainId: 11155111,
            canonicalAssetId: ASSET_ID,
            sourceLocalAssetId: ASSET_ID,
            destinationLocalAssetId: ASSET_ID,
            amount: 1 ether,
            sourceNullifierHash: bytes32(uint256(0x1234)),
            destinationCommitment: bytes32(uint256(0x5678)),
            sourceRoot: bytes32(uint256(0xaaaa)),
            sourceLeafIndex: 0,
            sourceTxHash: bytes32(uint256(0xbbbb)),
            sourceBlockNumber: 100,
            sourceFinalityBlock: 110,
            nonce: 1,
            deadline: uint64(block.timestamp + 1 days),
            relayerFee: 0.01 ether,
            recipientStealthMetadataHash: bytes32(0),
            memoHash: bytes32(0),
            reserved0: bytes32(0),
            reserved1: bytes32(0)
        });
    }

    function _sign(bytes32 hash, uint256 privateKey) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, hash);
        return abi.encodePacked(r, s, v);
    }

    function _sortedSigs(bytes32 messageHash) internal view returns (bytes[] memory) {
        // Determine signer order by address
        address[3] memory addrs = [signer1, signer2, signer3];
        uint256[3] memory keys = [signer1Key, signer2Key, signer3Key];

        // Simple sort (bubble sort for 3 elements)
        for (uint256 i = 0; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (addrs[i] > addrs[j]) {
                    (addrs[i], addrs[j]) = (addrs[j], addrs[i]);
                    (keys[i], keys[j]) = (keys[j], keys[i]);
                }
            }
        }

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(messageHash, keys[0]);
        sigs[1] = _sign(messageHash, keys[1]);
        return sigs;
    }

    // 1. Accepts valid message + threshold signatures
    function test_AcceptBridgeMint_Valid() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit BridgeMintAccepted(messageHash, msg_.destinationCommitment, ASSET_ID, 1 ether, 1);
        inbox.acceptBridgeMint(msg_, sigs, 1);

        assertTrue(inbox.isMessageConsumed(messageHash));
    }

    // 2. Rejects destinationDomain mismatch
    function test_AcceptBridgeMint_WrongDestination_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.destinationDomain = 999;

        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.InvalidDestinationDomain.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 3. Rejects sourceDomain == destinationDomain
    function test_AcceptBridgeMint_SameDomain_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        // Set both to localDomain so destination check passes but SameDomain fails
        msg_.sourceDomain = LOCAL_DOMAIN;
        msg_.destinationDomain = LOCAL_DOMAIN;

        // Need to enable route for localDomain since it's the "source"
        vm.prank(owner);
        inbox.enableRoute(LOCAL_DOMAIN);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.SameDomain.selector);
        inbox.acceptBridgeMint(msg_, new bytes[](0), 1);
    }

    // 4. Rejects unsupported route
    function test_AcceptBridgeMint_UnsupportedRoute_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.sourceDomain = 999;

        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(BridgeInbox.RouteNotEnabled.selector, uint32(999)));
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 5. Rejects paused route
    function test_AcceptBridgeMint_RoutePaused_Reverts() public {
        vm.prank(owner);
        inbox.setRoutePaused(SRC_DOMAIN, LOCAL_DOMAIN, true);

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.RoutePaused.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 6. Rejects globally paused
    function test_AcceptBridgeMint_GlobalPaused_Reverts() public {
        vm.prank(owner);
        inbox.setGlobalPaused(true);

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.GlobalPaused.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 7. Rejects frozen message
    function test_AcceptBridgeMint_FrozenMessage_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);

        vm.prank(owner);
        inbox.freezeMessage(messageHash);

        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.MessageIsFrozen.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 8. Rejects duplicate message hash
    function test_AcceptBridgeMint_DuplicateHash_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        inbox.acceptBridgeMint(msg_, sigs, 1);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.MessageAlreadyConsumed.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 9. Rejects expired deadline
    function test_AcceptBridgeMint_ExpiredDeadline_Reverts() public {
        vm.warp(10000); // set block.timestamp to something > 0
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.deadline = uint64(block.timestamp - 1); // past but non-zero

        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.DeadlineExpired.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 10. Enforces max message amount
    function test_AcceptBridgeMint_MaxAmountExceeded_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.amount = 11 ether;

        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.MaxMessageAmountExceeded.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 11. Enforces daily inflow cap (disable maxMessageAmount so cap is reached first)
    function test_AcceptBridgeMint_DailyCapExceeded_Reverts() public {
        vm.prank(owner);
        inbox.setMaxMessageAmount(ASSET_ID, 0);

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.amount = 101 ether;

        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.DailyInflowCapExceeded.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 12. Enforces global daily cap (disable maxMessageAmount and asset daily cap)
    function test_AcceptBridgeMint_GlobalDailyCapExceeded_Reverts() public {
        vm.startPrank(owner);
        inbox.setMaxMessageAmount(ASSET_ID, 0);
        inbox.setDailyInflowCap(ASSET_ID, 0); // disable asset daily cap
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.amount = 501 ether;

        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.GlobalDailyCapExceeded.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 13. Rejects invalid signer set version
    function test_AcceptBridgeMint_WrongSignerSetVersion_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.InvalidSignerSetVersion.selector);
        inbox.acceptBridgeMint(msg_, sigs, 99);
    }

    // 14. Rejects insufficient signatures (1-of-2)
    function test_AcceptBridgeMint_InsufficientSigs_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);

        // Only one signature
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(messageHash, signer1Key);

        vm.prank(user);
        vm.expectRevert(BridgeAttestationLib.ThresholdNotMet.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 15. Rejects invalid signature (attacker)
    function test_AcceptBridgeMint_InvalidSigner_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(messageHash, signer1Key);
        sigs[1] = _sign(messageHash, attackerKey);

        // Need to sort
        if (signer1 > attacker) {
            (sigs[0], sigs[1]) = (sigs[1], sigs[0]);
        }

        vm.prank(user);
        vm.expectRevert(BridgeAttestationLib.InvalidSigner.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 16. Rejects unsorted signatures
    function test_AcceptBridgeMint_UnsortedSigs_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);

        bytes[] memory sigs = new bytes[](2);
        // Intentionally put higher address first
        if (signer2 > signer1) {
            sigs[0] = _sign(messageHash, signer2Key);
            sigs[1] = _sign(messageHash, signer1Key);
        } else {
            sigs[0] = _sign(messageHash, signer1Key);
            sigs[1] = _sign(messageHash, signer2Key);
        }

        vm.prank(user);
        vm.expectRevert(BridgeAttestationLib.SignaturesNotSorted.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 17. Rejects wrong message hash (signatures don't match)
    function test_AcceptBridgeMint_WrongHash_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        // Sign a different hash
        bytes32 wrongHash = keccak256("wrong");
        bytes[] memory sigs = _sortedSigs(wrongHash);

        vm.prank(user);
        vm.expectRevert(BridgeAttestationLib.InvalidSigner.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 18. Freeze/unfreeze message
    function test_FreezeUnfreezeMessage() public {
        bytes32 messageHash = keccak256("test");

        assertFalse(inbox.isMessageFrozen(messageHash));
        vm.prank(owner);
        inbox.freezeMessage(messageHash);
        assertTrue(inbox.isMessageFrozen(messageHash));

        vm.prank(owner);
        inbox.unfreezeMessage(messageHash);
        assertFalse(inbox.isMessageFrozen(messageHash));
    }

    // 19. Non-owner cannot freeze
    function test_FreezeMessage_NonOwner_Reverts() public {
        vm.prank(user);
        vm.expectRevert();
        inbox.freezeMessage(keccak256("test"));
    }

    // 20. Rejects zero amount (BridgeInbox catches this before hashMessage)
    function test_AcceptBridgeMint_ZeroAmount_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.amount = 0;

        vm.prank(user);
        vm.expectRevert(BridgeInbox.AmountZero.selector);
        inbox.acceptBridgeMint(msg_, new bytes[](0), 1);
    }

    // 21. Rejects unsupported asset
    function test_AcceptBridgeMint_UnsupportedAsset_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.canonicalAssetId = bytes32(uint256(999));

        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.AssetNotSupported.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 22. Signer set update increments version
    function test_UpdateSignerSet_IncrementsVersion() public {
        assertEq(inbox.currentSignerSetVersion(), 1);

        address[] memory newSigners = new address[](2);
        newSigners[0] = makeAddr("new1");
        newSigners[1] = makeAddr("new2");

        vm.prank(owner);
        inbox.updateSignerSet(newSigners, 1);

        assertEq(inbox.currentSignerSetVersion(), 2);
    }

    // 23. Old signer set messages rejected after rotation
    function test_AcceptBridgeMint_OldSignerSet_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        // Rotate signer set
        address[] memory newSigners = new address[](2);
        newSigners[0] = makeAddr("new1");
        newSigners[1] = makeAddr("new2");
        vm.prank(owner);
        inbox.updateSignerSet(newSigners, 1);

        // Try to use old signatures with old version
        vm.prank(user);
        vm.expectRevert(BridgeInbox.InvalidSignerSetVersion.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 24. 5-of-7 threshold works
    function test_AcceptBridgeMint_5of7() public {
        // Generate 7 signers
        address[] memory signers = new address[](7);
        uint256[] memory keys = new uint256[](7);
        for (uint256 i = 0; i < 7; i++) {
            keys[i] = uint256(keccak256(abi.encodePacked("signer", i)));
            signers[i] = vm.addr(keys[i]);
        }

        // Sort
        for (uint256 i = 0; i < signers.length; i++) {
            for (uint256 j = i + 1; j < signers.length; j++) {
                if (signers[i] > signers[j]) {
                    (signers[i], signers[j]) = (signers[j], signers[i]);
                    (keys[i], keys[j]) = (keys[j], keys[i]);
                }
            }
        }

        vm.prank(owner);
        inbox.updateSignerSet(signers, 5);

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);

        bytes[] memory sigs = new bytes[](5);
        for (uint256 i = 0; i < 5; i++) {
            sigs[i] = _sign(messageHash, keys[i]);
        }

        vm.prank(user);
        inbox.acceptBridgeMint(msg_, sigs, 2);
        assertTrue(inbox.isMessageConsumed(BridgeMessageLib.hashMessage(msg_)));
    }

    // 25. Valid mint inserts commitment into WhiteProtocol Merkle tree
    function test_AcceptBridgeMint_InsertsCommitment() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        inbox.acceptBridgeMint(msg_, sigs, 1);

        // Commitment should be inserted into Merkle tree
        assertEq(whiteProtocol.nextLeafIndex(), 1);
        assertTrue(whiteProtocol.bridgeCommitments(uint256(msg_.destinationCommitment)));
        assertEq(whiteProtocol.bridgeIncoming(LOCAL_ASSET), msg_.amount);
    }

    // 26. Duplicate commitment is rejected
    function test_AcceptBridgeMint_DuplicateCommitment_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        inbox.acceptBridgeMint(msg_, sigs, 1);

        // Try same commitment with different nonce (different message hash)
        BridgeMessageLib.BridgeMessageV1 memory msg2 = msg_;
        msg2.nonce = 2;
        bytes32 messageHash2 = BridgeMessageLib.hashMessage(msg2);
        bytes[] memory sigs2 = _sortedSigs(messageHash2);

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.CommitmentAlreadyInserted.selector);
        inbox.acceptBridgeMint(msg2, sigs2, 1);
    }

    // 27. Local asset not set reverts
    function test_AcceptBridgeMint_LocalAssetNotSet_Reverts() public {
        // Support a new asset but don't set its local asset mapping
        bytes32 newAssetId = bytes32(uint256(999));
        vm.prank(owner);
        inbox.supportAsset(newAssetId);

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        msg_.canonicalAssetId = newAssetId;
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(BridgeInbox.LocalAssetNotSet.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }

    // 28. Bridge not set on WhiteProtocol reverts
    function test_AcceptBridgeMint_BridgeNotSet_Reverts() public {
        vm.prank(owner);
        whiteProtocol.setBridge(address(0));

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage();
        bytes32 messageHash = BridgeMessageLib.hashMessage(msg_);
        bytes[] memory sigs = _sortedSigs(messageHash);

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.BridgeNotSet.selector);
        inbox.acceptBridgeMint(msg_, sigs, 1);
    }
}
