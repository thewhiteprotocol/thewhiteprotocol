// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/bridge/BridgeAssetRegistry.sol";

contract BridgeAssetRegistryTest is Test {
    BridgeAssetRegistry public registry;
    address public owner;
    address public user;

    function setUp() public {
        owner = makeAddr("owner");
        user = makeAddr("user");
        registry = new BridgeAssetRegistry(owner);
    }

    function test_SetMapping() public {
        vm.prank(owner);
        registry.setMapping(address(0x1234), 1);
        assertEq(registry.localToCanonical(address(0x1234)), 1);
        assertEq(registry.canonicalToLocal(1), address(0x1234));
    }

    function test_SetMapping_ZeroAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(BridgeAssetRegistry.ZeroAddress.selector);
        registry.setMapping(address(0), 1);
    }

    function test_SetMapping_InvalidCanonical_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(BridgeAssetRegistry.InvalidCanonical.selector);
        registry.setMapping(address(0x1234), 0);
    }

    function test_SetMapping_DuplicateLocal_Reverts() public {
        vm.prank(owner);
        registry.setMapping(address(0x1234), 1);
        vm.prank(owner);
        vm.expectRevert(BridgeAssetRegistry.AssetAlreadyMapped.selector);
        registry.setMapping(address(0x1234), 2);
    }

    function test_SetMapping_DuplicateCanonical_Reverts() public {
        vm.prank(owner);
        registry.setMapping(address(0x1234), 1);
        vm.prank(owner);
        vm.expectRevert(BridgeAssetRegistry.CanonicalAlreadyAssigned.selector);
        registry.setMapping(address(0x5678), 1);
    }

    function test_RemoveMapping() public {
        vm.prank(owner);
        registry.setMapping(address(0x1234), 1);
        vm.prank(owner);
        registry.removeMapping(address(0x1234));
        assertEq(registry.localToCanonical(address(0x1234)), 0);
        assertEq(registry.canonicalToLocal(1), address(0));
    }

    function test_RemoveMapping_NotMapped_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(BridgeAssetRegistry.AssetNotMapped.selector);
        registry.removeMapping(address(0x1234));
    }

    function test_IsSupported() public {
        assertFalse(registry.isSupported(address(0x1234)));
        vm.prank(owner);
        registry.setMapping(address(0x1234), 1);
        assertTrue(registry.isSupported(address(0x1234)));
    }

    function test_NonOwnerCannotSetMapping() public {
        vm.prank(user);
        vm.expectRevert();
        registry.setMapping(address(0x1234), 1);
    }
}
