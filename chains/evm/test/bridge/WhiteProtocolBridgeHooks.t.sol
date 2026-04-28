// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/WhiteProtocol.sol";
import "../../contracts/AssetRegistry.sol";

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
        assetRegistry.addAsset(address(0), false, 18, 0.001 ether, 1000 ether);
        vm.stopPrank();
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
    }

    function test_BridgeMint_NonBridge_Reverts() public {
        vm.prank(owner);
        whiteProtocol.setBridge(bridge);

        vm.prank(makeAddr("not-bridge"));
        vm.expectRevert(WhiteProtocol.OnlyBridge.selector);
        whiteProtocol.bridgeMint(address(0), 1 ether, bytes32(uint256(42)));
    }

    function test_BridgeMint_BridgeNotSet_Reverts() public {
        // When bridge is not set (address(0)), any non-zero caller hits OnlyBridge first
        vm.prank(bridge);
        vm.expectRevert(WhiteProtocol.OnlyBridge.selector);
        whiteProtocol.bridgeMint(address(0), 1 ether, bytes32(uint256(42)));
    }
}
