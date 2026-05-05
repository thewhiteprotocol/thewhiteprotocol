// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/WhiteProtocol.sol";
import "../../contracts/AssetRegistry.sol";
import "../../contracts/BridgeOutbox.sol";
import "../../contracts/libraries/BridgeMessageLib.sol";

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

contract WhiteProtocolBridgeHooksTest is Test {
    WhiteProtocol public whiteProtocol;
    AssetRegistry public assetRegistry;
    MockDepositVerifier public depositVerifier;
    MockWithdrawVerifier public withdrawVerifier;
    MockMerkleBatchVerifier public merkleBatchVerifier;

    address public owner = makeAddr("owner");
    address public bridge = makeAddr("bridge");
    address public user = makeAddr("user");

    uint32 constant LOCAL_DOMAIN = 33554434; // Base Sepolia
    uint32 constant DST_DOMAIN = 33554435;   // Ethereum Sepolia
    bytes32 constant ASSET_ID = bytes32(uint256(1));

    bytes constant MOCK_PROOF = hex"00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";

    function setUp() public {
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
        // Configure domain for v2 asset IDs before adding assets
        assetRegistry.configureDomain(LOCAL_DOMAIN, 2);
        assetRegistry.addAsset(address(0), false, 18, 0.001 ether, 1000 ether);

        // Set domain ID on WhiteProtocol
        whiteProtocol.setDomainId(LOCAL_DOMAIN);
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
            canonicalAssetId: assetRegistry.getAssetId(address(0)),
            sourceLocalAssetId: assetRegistry.getAssetId(address(0)),
            destinationLocalAssetId: assetRegistry.getAssetId(address(0)),
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

    function test_SetBridge() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);
        assertEq(whiteProtocol.bridge(), bridge);
    }

    function test_BridgeWithdraw_Success() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);

        bytes32 nullifierHash = bytes32(uint256(1));
        bytes32 extDataHash = bytes32(uint256(2));
        uint256 amount = 1 ether;

        // Fund the pool with ETH so the bridge liability is covered
        vm.deal(address(whiteProtocol), 10 ether);

        vm.prank(bridge);
        whiteProtocol.bridgeWithdraw(MOCK_PROOF, nullifierHash, address(0), amount, extDataHash);

        assertTrue(whiteProtocol.spentNullifiers(uint256(nullifierHash)));
        assertEq(whiteProtocol.bridgeOutgoing(address(0)), amount);
    }

    function test_BridgeWithdraw_NullifierReplay_Reverts() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);

        bytes32 nullifierHash = bytes32(uint256(1));
        bytes32 extDataHash = bytes32(uint256(2));
        uint256 amount = 1 ether;

        vm.deal(address(whiteProtocol), 10 ether);

        vm.prank(bridge);
        whiteProtocol.bridgeWithdraw(MOCK_PROOF, nullifierHash, address(0), amount, extDataHash);

        vm.prank(bridge);
        vm.expectRevert(WhiteProtocol.NullifierUsed.selector);
        whiteProtocol.bridgeWithdraw(MOCK_PROOF, nullifierHash, address(0), amount, extDataHash);
    }

    function test_BridgeWithdraw_NonBridge_Reverts() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);

        vm.prank(makeAddr("not-bridge"));
        vm.expectRevert(WhiteProtocol.OnlyBridge.selector);
        whiteProtocol.bridgeWithdraw(MOCK_PROOF, bytes32(uint256(1)), address(0), 1 ether, bytes32(0));
    }

    function test_BridgeWithdraw_BridgeNotSet_Reverts() public {
        // When bridge is not set (address(0)), any non-zero caller hits OnlyBridge first
        vm.prank(bridge);
        vm.expectRevert(WhiteProtocol.OnlyBridge.selector);
        whiteProtocol.bridgeWithdraw(MOCK_PROOF, bytes32(uint256(1)), address(0), 1 ether, bytes32(0));
    }

    function test_BridgeMint_Success() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);

        bytes32 newCommitment = bytes32(uint256(42));
        uint256 amount = 1 ether;

        vm.prank(bridge);
        whiteProtocol.bridgeMint(address(0), amount, newCommitment);

        assertEq(whiteProtocol.bridgeIncoming(address(0)), amount);
        assertEq(whiteProtocol.nextLeafIndex(), 1);
        assertTrue(whiteProtocol.bridgeCommitments(uint256(newCommitment)));
    }

    function test_BridgeMint_DuplicateCommitment_Reverts() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);

        bytes32 newCommitment = bytes32(uint256(42));
        uint256 amount = 1 ether;

        vm.prank(bridge);
        whiteProtocol.bridgeMint(address(0), amount, newCommitment);

        vm.prank(bridge);
        vm.expectRevert(WhiteProtocol.CommitmentAlreadyInserted.selector);
        whiteProtocol.bridgeMint(address(0), amount, newCommitment);
    }

    function test_BridgeMint_NonBridge_Reverts() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);

        vm.prank(makeAddr("not-bridge"));
        vm.expectRevert(WhiteProtocol.OnlyBridge.selector);
        whiteProtocol.bridgeMint(address(0), 1 ether, bytes32(uint256(42)));
    }

    function test_BridgeMint_BridgeNotSet_Reverts() public {
        // When bridge is not set (address(0)), BridgeNotSet is checked first
        vm.prank(bridge);
        vm.expectRevert(WhiteProtocol.BridgeNotSet.selector);
        whiteProtocol.bridgeMint(address(0), 1 ether, bytes32(uint256(42)));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // bridgeOutV1 tests
    // ─────────────────────────────────────────────────────────────────────────

    function test_BridgeOutV1_Success() public {
        // Deploy and configure BridgeOutbox
        vm.startPrank(owner);
        BridgeOutbox outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);
        outbox.enableRoute(DST_DOMAIN);
        outbox.supportAsset(assetRegistry.getAssetId(address(0)));
        outbox.setMaxMessageAmount(assetRegistry.getAssetId(address(0)), 10 ether);
        outbox.setOutflowCap(assetRegistry.getAssetId(address(0)), 100 ether);

        // Wire WhiteProtocol ↔ BridgeOutbox
        whiteProtocol.setBridgeOutbox(address(outbox));
        outbox.setWhiteProtocol(address(whiteProtocol));
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);

        vm.prank(user);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));

        assertTrue(whiteProtocol.spentNullifiers(uint256(msg_.sourceNullifierHash)));
        assertEq(whiteProtocol.bridgeOutgoing(address(0)), msg_.amount);
        assertEq(outbox.outboundNonce(DST_DOMAIN), 1);
    }

    function test_BridgeOutV1_NullifierReplay_Reverts() public {
        vm.startPrank(owner);
        BridgeOutbox outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);
        outbox.enableRoute(DST_DOMAIN);
        outbox.supportAsset(assetRegistry.getAssetId(address(0)));
        outbox.setMaxMessageAmount(assetRegistry.getAssetId(address(0)), 10 ether);
        outbox.setOutflowCap(assetRegistry.getAssetId(address(0)), 100 ether);
        whiteProtocol.setBridgeOutbox(address(outbox));
        outbox.setWhiteProtocol(address(whiteProtocol));
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);

        vm.prank(user);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.NullifierUsed.selector);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));
    }

    function test_BridgeOutV1_BridgeOutboxNotSet_Reverts() public {
        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.BridgeOutboxNotSet.selector);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));
    }

    function test_BridgeOutV1_AssetMismatch_Reverts() public {
        vm.startPrank(owner);
        BridgeOutbox outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);
        whiteProtocol.setBridgeOutbox(address(outbox));
        outbox.setWhiteProtocol(address(whiteProtocol));
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        // Corrupt the sourceLocalAssetId so it no longer matches ETH
        msg_.sourceLocalAssetId = bytes32(uint256(999));

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.AssetMismatch.selector);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));
    }

    function test_BridgeOutV1_InvalidSourceDomain_Reverts() public {
        vm.startPrank(owner);
        BridgeOutbox outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);
        whiteProtocol.setBridgeOutbox(address(outbox));
        outbox.setWhiteProtocol(address(whiteProtocol));
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.sourceDomain = 999;

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.InvalidSourceDomain.selector);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));
    }

    function test_BridgeOutV1_SameDomain_Reverts() public {
        vm.startPrank(owner);
        BridgeOutbox outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);
        whiteProtocol.setBridgeOutbox(address(outbox));
        outbox.setWhiteProtocol(address(whiteProtocol));
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.destinationDomain = LOCAL_DOMAIN;

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.SameDomain.selector);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));
    }

    function test_BridgeOutV1_ZeroDestinationCommitment_Reverts() public {
        vm.startPrank(owner);
        BridgeOutbox outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);
        whiteProtocol.setBridgeOutbox(address(outbox));
        outbox.setWhiteProtocol(address(whiteProtocol));
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);
        msg_.destinationCommitment = bytes32(0);

        vm.prank(user);
        vm.expectRevert(WhiteProtocol.ZeroCommitment.selector);
        whiteProtocol.bridgeOutV1(MOCK_PROOF, msg_, address(0));
    }

    function test_BridgeOutV1_OnlyWhiteProtocolCanCallInitBridgeOutFromProtocol() public {
        vm.startPrank(owner);
        BridgeOutbox outbox = new BridgeOutbox(owner, LOCAL_DOMAIN);
        whiteProtocol.setBridgeOutbox(address(outbox));
        outbox.setWhiteProtocol(address(whiteProtocol));
        vm.stopPrank();

        BridgeMessageLib.BridgeMessageV1 memory msg_ = _makeValidMessage(1);

        vm.prank(user);
        vm.expectRevert(BridgeOutbox.OnlyWhiteProtocol.selector);
        outbox.initBridgeOutFromProtocol(msg_);
    }

    function test_SetBridgeOutbox() public {
        vm.prank(owner);
        whiteProtocol.setBridgeOutbox(address(0xabc));
        assertEq(whiteProtocol.bridgeOutbox(), address(0xabc));
    }
}
