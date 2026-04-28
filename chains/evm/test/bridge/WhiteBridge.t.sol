// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

import { MessagingFee, MessagingReceipt } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { OptionsBuilderLite } from "../mocks/OptionsBuilderLite.sol";
import { MockEndpointV2, MockLzNetwork } from "../mocks/MockEndpointV2.sol";

import "../../contracts/bridge/WhiteBridge.sol";
import "../../contracts/bridge/BridgeAssetRegistry.sol";

// Mock WhiteProtocol that records bridge calls
contract MockWhiteProtocol {
    mapping(bytes32 => bool) public spentNullifiers;
    mapping(address => uint256) public bridgeOutgoing;
    mapping(address => uint256) public bridgeIncoming;
    uint256[] internal _commitments;

    function commitments(uint256 index) external view returns (uint256) {
        return _commitments[index];
    }

    function commitmentsLength() external view returns (uint256) {
        return _commitments.length;
    }

    function bridgeWithdraw(
        bytes calldata,
        bytes32 nullifierHash,
        address asset,
        uint256 amount,
        bytes32
    ) external {
        require(!spentNullifiers[nullifierHash], "Nullifier spent");
        spentNullifiers[nullifierHash] = true;
        bridgeOutgoing[asset] += amount;
    }

    function bridgeMint(address asset, uint256 amount, bytes32 newCommitment) external {
        bridgeIncoming[asset] += amount;
        _commitments.push(uint256(newCommitment));
    }
}

contract WhiteBridgeTest is Test {
    using OptionsBuilderLite for bytes;

    uint32 aEid = 1;
    uint32 bEid = 2;

    MockLzNetwork public network;
    MockEndpointV2 public endpointA;
    MockEndpointV2 public endpointB;

    MockWhiteProtocol public whiteA;
    MockWhiteProtocol public whiteB;
    BridgeAssetRegistry public registryA;
    BridgeAssetRegistry public registryB;
    WhiteBridge public bridgeA;
    WhiteBridge public bridgeB;

    address public owner = makeAddr("owner");
    address public user = makeAddr("user");

    function setUp() public {
        // Deploy shared network and mock endpoints
        network = new MockLzNetwork();
        endpointA = new MockEndpointV2(aEid, network);
        endpointB = new MockEndpointV2(bEid, network);

        // Deploy mock WhiteProtocols
        whiteA = new MockWhiteProtocol();
        whiteB = new MockWhiteProtocol();

        // Deploy registries
        vm.prank(owner);
        registryA = new BridgeAssetRegistry(owner);
        vm.prank(owner);
        registryB = new BridgeAssetRegistry(owner);

        // Configure mappings on both chains: local WETH -> canonical 1
        vm.prank(owner);
        registryA.setMapping(address(0xAAA), 1);
        vm.prank(owner);
        registryB.setMapping(address(0xBBB), 1);

        // Deploy bridges pointing to respective endpoints
        bridgeA = new WhiteBridge(address(endpointA), owner, address(whiteA), address(registryA));
        bridgeB = new WhiteBridge(address(endpointB), owner, address(whiteB), address(registryB));

        // Wire peers (owner only)
        vm.startPrank(owner);
        bridgeA.setPeer(bEid, bytes32(uint256(uint160(address(bridgeB)))));
        bridgeB.setPeer(aEid, bytes32(uint256(uint160(address(bridgeA)))));
        vm.stopPrank();

        // Set caps
        vm.startPrank(owner);
        bridgeA.setOutflowCap(address(0xAAA), 100 ether);
        bridgeA.setInflowCap(address(0xAAA), 100 ether);
        bridgeB.setOutflowCap(address(0xBBB), 100 ether);
        bridgeB.setInflowCap(address(0xBBB), 100 ether);
        vm.stopPrank();
    }

    // 1. Happy path same-asset bridge A->B
    function test_BridgeOut_HappyPath() public {
        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(bEid, address(0xAAA), 1 ether, bytes32(uint256(123)), options);
        assertGt(fee.nativeFee, 0);

        vm.deal(user, 10 ether);
        vm.prank(user);
        bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );

        assertTrue(whiteA.spentNullifiers(bytes32(uint256(1))));
        assertEq(whiteA.bridgeOutgoing(address(0xAAA)), 1 ether);

        // Deliver cross-chain message
        network.verifyPackets(endpointB, address(bridgeB));

        assertEq(whiteB.bridgeIncoming(address(0xBBB)), 1 ether);
        assertEq(whiteB.commitments(0), uint256(123));
    }

    // 2. Replay defense
    function test_BridgeOut_Replay_Reverts() public {
        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(bEid, address(0xAAA), 1 ether, bytes32(uint256(123)), options);

        vm.deal(user, 10 ether);
        vm.prank(user);
        bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );

        vm.prank(user);
        vm.expectRevert("Nullifier spent");
        bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(456)),
            options
        );
    }

    // 3. Wrong asset
    function test_BridgeOut_UnsupportedAsset_Reverts() public {
        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        vm.deal(user, 10 ether);
        vm.prank(user);
        vm.expectRevert(WhiteBridge.UnsupportedAsset.selector);
        bridgeA.bridgeOut{ value: 0.01 ether }(
            hex"",
            bytes32(uint256(1)),
            address(0xBAD),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );
    }

    // 4. No peer
    function test_BridgeOut_NoPeer_Reverts() public {
        // Remove peer first
        vm.prank(owner);
        bridgeA.setPeer(bEid, bytes32(0));

        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        vm.deal(user, 10 ether);
        vm.prank(user);
        vm.expectRevert(WhiteBridge.UnsupportedDestination.selector);
        bridgeA.bridgeOut{ value: 0.01 ether }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );
    }

    // 5. Outflow cap
    function test_BridgeOut_OutflowCapExceeded() public {
        vm.prank(owner);
        bridgeA.setOutflowCap(address(0xAAA), 0.5 ether);

        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(
            bEid,
            address(0xAAA),
            0.6 ether,
            bytes32(uint256(123)),
            options
        );

        vm.deal(user, 10 ether);
        vm.prank(user);
        vm.expectRevert(WhiteBridge.OutflowCapExceeded.selector);
        bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            0.6 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );
    }

    // 6. Inflow cap with parking
    function test_BridgeIn_InflowCap_Parked() public {
        vm.prank(owner);
        bridgeB.setInflowCap(address(0xBBB), 0.5 ether);

        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(bEid, address(0xAAA), 1 ether, bytes32(uint256(123)), options);

        vm.deal(user, 10 ether);
        vm.prank(user);
        MessagingReceipt memory receipt = bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );

        assertEq(whiteB.bridgeIncoming(address(0xBBB)), 0);
        assertEq(whiteB.commitmentsLength(), 0);

        network.verifyPackets(endpointB, address(bridgeB));

        assertEq(whiteB.bridgeIncoming(address(0xBBB)), 0);
        (,,,, uint64 parkedAt) = bridgeB.parkedMessages(receipt.guid);
        assertTrue(parkedAt > 0);
    }

    // 7. Recovery execution
    function test_RecoveryExecution() public {
        vm.prank(owner);
        bridgeB.setInflowCap(address(0xBBB), 0.5 ether);

        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(bEid, address(0xAAA), 1 ether, bytes32(uint256(123)), options);

        vm.deal(user, 10 ether);
        vm.prank(user);
        MessagingReceipt memory receipt = bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );
        network.verifyPackets(endpointB, address(bridgeB));

        // Raise cap
        vm.prank(owner);
        bridgeB.setInflowCap(address(0xBBB), 100 ether);

        bridgeB.executeRecovery(receipt.guid);
        assertEq(whiteB.bridgeIncoming(address(0xBBB)), 1 ether);
        assertEq(whiteB.commitments(0), uint256(123));
        (,,,, uint64 parkedAt2) = bridgeB.parkedMessages(receipt.guid);
        assertEq(parkedAt2, 0);
    }

    // 8. Untrusted peer — OApp peer check prevents _lzReceive from non-peer
    // This is implicitly tested by the peer mechanism; manual _lzReceive from wrong origin isn't callable externally.

    // 9. Quote returns non-zero fee
    function test_Quote_NonZeroFee() public {
        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(
            bEid,
            address(0xAAA),
            1 ether,
            bytes32(uint256(123)),
            options
        );
        assertGt(fee.nativeFee, 0);
    }

    // 10. Solvency invariant
    function test_SolvencyInvariant() public {
        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(bEid, address(0xAAA), 1 ether, bytes32(uint256(123)), options);

        vm.deal(user, 10 ether);
        vm.prank(user);
        bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );
        network.verifyPackets(endpointB, address(bridgeB));

        assertEq(whiteA.bridgeOutgoing(address(0xAAA)), 1 ether);
        assertEq(whiteB.bridgeIncoming(address(0xBBB)), 1 ether);
    }

    // 11. Cross-canonical rejected: bridgeOut sends canonical=1, but B registry doesn't have canonical=1 mapped -> UnknownCanonicalAsset on receive
    function test_CrossCanonical_Rejected() public {
        // Remove mapping on B so canonical 1 has no local asset
        vm.prank(owner);
        registryB.removeMapping(address(0xBBB));

        bytes memory options = OptionsBuilderLite.newOptions().addExecutorLzReceiveOption(200000, 0);
        MessagingFee memory fee = bridgeA.quoteBridgeOut(bEid, address(0xAAA), 1 ether, bytes32(uint256(123)), options);

        vm.deal(user, 10 ether);
        vm.prank(user);
        bridgeA.bridgeOut{ value: fee.nativeFee }(
            hex"",
            bytes32(uint256(1)),
            address(0xAAA),
            1 ether,
            bEid,
            bytes32(uint256(123)),
            options
        );

        // verifyPackets should revert because _lzReceive reverts with UnknownCanonicalAsset
        vm.expectRevert(WhiteBridge.UnknownCanonicalAsset.selector);
        network.verifyPackets(endpointB, address(bridgeB));
    }
}
