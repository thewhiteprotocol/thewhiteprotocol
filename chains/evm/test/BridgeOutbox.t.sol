// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/BridgeOutbox.sol";
import "../contracts/libraries/BridgeMessageLib.sol";

contract BridgeOutboxTest is Test {
    // Local event for expectEmit
    event BridgeOutInitiated(
        bytes32 indexed messageHash,
        uint32 indexed destinationDomain,
        bytes32 indexed canonicalAssetId,
        uint128 amount,
        uint64 nonce,
        bytes encodedMessage
    );

    BridgeOutbox public outbox;
    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    uint32 constant LOCAL_DOMAIN = 33554434; // Base Sepolia
    uint32 constant DST_DOMAIN = 33554435;   // Ethereum Sepolia

    bytes32 constant ASSET_ID = bytes32(uint256(1));

    function setUp() public {
        vm.prank(owner);
        outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);

        // Enable route and asset
        vm.startPrank(owner);
        outbox.enableRoute(DST_DOMAIN);
        outbox.supportAsset(ASSET_ID);
        outbox.setMaxMessageAmount(ASSET_ID, 10 ether);
        outbox.setOutflowCap(ASSET_ID, 100 ether);
        vm.stopPrank();
    }

    function _makeValidMessage(uint64 nonce) internal view returns (BridgeMessageLib.BridgeMessageV1 memory) {
        return BridgeMessageLib.BridgeMessageV1({
            protocolVersion: 1,
            messageType: BridgeMessageLib.MESSAGE_TYPE_BRIDGE_OUT,
            sourceDomain: LOCAL_DOMAIN,
            destinationDomain: DST_DOMAIN,
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
            nonce: nonce,
            deadline: uint64(block.timestamp + 1 days),
            relayerFee: 0.01 ether,
            recipientStealthMetadataHash: bytes32(0),
            memoHash: bytes32(0),
            reserved0: bytes32(0),
            reserved1: bytes32(0)
        });
    }

    // 1. Emits BridgeOutInitiated for valid message
    function test_InitBridgeOut_EmitsEvent() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);

        vm.prank(owner);
        vm.expectEmit(true, true, true, true);
        bytes32 expectedHash = BridgeMessageLib.hashMessage(msg_);
        bytes memory encoded = BridgeMessageLib.encodeMessage(msg_);
        emit BridgeOutInitiated(expectedHash, DST_DOMAIN, ASSET_ID, 1 ether, 1, encoded);
        outbox.initBridgeOut(msg_);
    }

    // 2. Rejects wrong sourceDomain
    function test_InitBridgeOut_WrongSourceDomain_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.sourceDomain = 999;

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.InvalidSourceDomain.selector);
        outbox.initBridgeOut(msg_);
    }

    // 3. Rejects same source/destination
    function test_InitBridgeOut_SameDomain_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.destinationDomain = LOCAL_DOMAIN;

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.SameDomain.selector);
        outbox.initBridgeOut(msg_);
    }

    // 4. Rejects disabled destination route
    function test_InitBridgeOut_DisabledRoute_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.destinationDomain = 999;

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BridgeOutbox.RouteNotEnabled.selector, uint32(999)));
        outbox.initBridgeOut(msg_);
    }

    // 5. Nonce increments correctly
    function test_InitBridgeOut_NonceIncrements() public {
        BridgeMessageLib.BridgeMessageV1 memory msg1 = _makeValidMessage(1);
        vm.prank(owner);
        outbox.initBridgeOut(msg1);
        assertEq(outbox.outboundNonce(DST_DOMAIN), 1);

        BridgeMessageLib.BridgeMessageV1 memory msg2 = _makeValidMessage(2);
        vm.prank(owner);
        outbox.initBridgeOut(msg2);
        assertEq(outbox.outboundNonce(DST_DOMAIN), 2);
    }

    // 6. Wrong nonce fails
    function test_InitBridgeOut_WrongNonce_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(2); // expected is 1

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.NonceMismatch.selector);
        outbox.initBridgeOut(msg_);
    }

    // 7. Rejects zero amount
    function test_InitBridgeOut_ZeroAmount_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.amount = 0;

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.AmountZero.selector);
        outbox.initBridgeOut(msg_);
    }

    // 8. Rejects unsupported asset
    function test_InitBridgeOut_UnsupportedAsset_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.canonicalAssetId = bytes32(uint256(999));

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.AssetNotSupported.selector);
        outbox.initBridgeOut(msg_);
    }

    // 9. Enforces max message amount
    function test_InitBridgeOut_MaxAmountExceeded_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.amount = 11 ether;

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.MaxMessageAmountExceeded.selector);
        outbox.initBridgeOut(msg_);
    }

    // 10. Enforces outflow cap (disable maxMessageAmount so cap is reached first)
    function test_InitBridgeOut_OutflowCapExceeded_Reverts() public {
        vm.prank(owner);
        outbox.setMaxMessageAmount(ASSET_ID, 0); // disable max message amount

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.amount = 101 ether;

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.DailyOutflowCapExceeded.selector);
        outbox.initBridgeOut(msg_);
    }

    // 11. Rejects expired deadline
    function test_InitBridgeOut_ExpiredDeadline_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.deadline = uint64(block.timestamp - 1);

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.InvalidDeadline.selector);
        outbox.initBridgeOut(msg_);
    }

    // 12. Rejects duplicate message hash
    function test_InitBridgeOut_DuplicateHash_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);

        vm.prank(owner);
        outbox.initBridgeOut(msg_);

        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.AlreadyRecorded.selector);
        outbox.initBridgeOut(msg_);
    }

    // 13. Global pause stops all
    function test_InitBridgeOut_GlobalPaused_Reverts() public {
        vm.prank(owner);
        outbox.setGlobalPaused(true);

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.GlobalPaused.selector);
        outbox.initBridgeOut(msg_);
    }

    // 14. Route pause stops route
    function test_InitBridgeOut_RoutePaused_Reverts() public {
        vm.prank(owner);
        outbox.setRoutePaused(LOCAL_DOMAIN, DST_DOMAIN, true);

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        vm.prank(owner);
        vm.expectRevert(BridgeOutbox.RoutePaused.selector);
        outbox.initBridgeOut(msg_);
    }

    // 15. Owner can enable/disable route
    function test_EnableDisableRoute() public {
        uint32 newDst = 33554436;

        assertFalse(outbox.isRouteEnabled(newDst));
        vm.prank(owner);
        outbox.enableRoute(newDst);
        assertTrue(outbox.isRouteEnabled(newDst));

        vm.prank(owner);
        outbox.disableRoute(newDst);
        assertFalse(outbox.isRouteEnabled(newDst));
    }

    // 16. Non-owner cannot enable route
    function test_EnableRoute_NonOwner_Reverts() public {
        vm.prank(user);
        vm.expectRevert();
        outbox.enableRoute(999);
    }

    // 17. Records message hash
    function test_InitBridgeOut_RecordsHash() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        bytes32 hash = BridgeMessageLib.hashMessage(msg_);

        assertFalse(outbox.outboundMessageHashRecorded(hash));
        vm.prank(owner);
        outbox.initBridgeOut(msg_);
        assertTrue(outbox.outboundMessageHashRecorded(hash));
    }
}
