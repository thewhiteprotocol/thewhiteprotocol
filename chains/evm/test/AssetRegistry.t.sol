// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/AssetRegistry.sol";

contract AssetRegistryTest is Test {
    AssetRegistry public assetRegistry;
    address public owner = address(1);

    // BN254 scalar field prime
    uint256 constant BN254_FIELD_MODULUS =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    function setUp() public {
        vm.prank(owner);
        assetRegistry = new AssetRegistry(owner);
    }

    function test_AssetIdForAddressZeroIsFieldSafe() public {
        vm.prank(owner);
        assetRegistry.addAsset(address(0), false, 18, 0.001 ether, 100 ether);

        bytes32 assetId = assetRegistry.getAssetId(address(0));
        uint256 assetIdUint = uint256(assetId);

        assertLt(assetIdUint, BN254_FIELD_MODULUS, "address(0) asset ID exceeds field prime");
        assertEq(assetIdUint >> 248, 0, "address(0) asset ID MSB must be zero");
    }

    function test_AssetIdForWETHIsFieldSafe() public {
        address weth = 0x4200000000000000000000000000000000000006;

        vm.prank(owner);
        assetRegistry.addAsset(weth, false, 18, 0.001 ether, 100 ether);

        bytes32 assetId = assetRegistry.getAssetId(weth);
        uint256 assetIdUint = uint256(assetId);

        assertLt(assetIdUint, BN254_FIELD_MODULUS, "WETH asset ID exceeds field prime");
        assertEq(assetIdUint >> 248, 0, "WETH asset ID MSB must be zero");
    }

    function test_AssetIdForRandomAddressIsFieldSafe() public {
        address randomToken = address(0x1234567890123456789012345678901234567890);

        vm.prank(owner);
        assetRegistry.addAsset(randomToken, false, 18, 1, 1000000);

        bytes32 assetId = assetRegistry.getAssetId(randomToken);
        uint256 assetIdUint = uint256(assetId);

        assertLt(assetIdUint, BN254_FIELD_MODULUS, "Random asset ID exceeds field prime");
        assertEq(assetIdUint >> 248, 0, "Random asset ID MSB must be zero");
    }

    function test_AssetIdFormulaMatchesCanonical() public {
        // Compute expected asset ID using the canonical formula manually
        bytes memory prefix = bytes("white:asset_id:v1");
        bytes memory input = abi.encodePacked(prefix, address(0));
        bytes32 hash = keccak256(input);
        bytes32 expected = bytes32(uint256(hash) >> 8);

        vm.prank(owner);
        assetRegistry.addAsset(address(0), false, 18, 0.001 ether, 100 ether);

        bytes32 actual = assetRegistry.getAssetId(address(0));
        assertEq(actual, expected, "Asset ID formula mismatch");
    }

    function test_AddAssetAndRemoveAsset() public {
        address token = address(0xABC);

        vm.prank(owner);
        assetRegistry.addAsset(token, false, 6, 1, 1000000);

        assertTrue(assetRegistry.isSupported(token));
        assertEq(assetRegistry.getAssetCount(), 1);

        vm.prank(owner);
        assetRegistry.removeAsset(token);

        assertFalse(assetRegistry.isSupported(token));
        assertEq(assetRegistry.getAssetCount(), 0);
    }

    function test_RevertAddAssetDuplicate() public {
        address token = address(0xABC);

        vm.prank(owner);
        assetRegistry.addAsset(token, false, 6, 1, 1000000);

        vm.prank(owner);
        vm.expectRevert("Asset already supported");
        assetRegistry.addAsset(token, false, 6, 1, 1000000);
    }
}
