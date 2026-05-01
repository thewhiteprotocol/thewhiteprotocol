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

    // Example domain IDs
    uint32 constant DOMAIN_BASE_SEPOLIA = 0x02000002;

    event DomainConfigured(uint32 domainId, uint8 assetIdVersion);

    function setUp() public {
        vm.prank(owner);
        assetRegistry = new AssetRegistry(owner);
    }

    // =========================================================================
    // v1 Tests (backward compatibility — default behavior)
    // =========================================================================

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

    // =========================================================================
    // v2 Tests (domain-separated asset IDs)
    // =========================================================================

    function test_V2AssetIdIsFieldSafe() public {
        vm.prank(owner);
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);

        address weth = 0x4200000000000000000000000000000000000006;
        vm.prank(owner);
        assetRegistry.addAsset(weth, false, 18, 0.001 ether, 100 ether);

        bytes32 assetId = assetRegistry.getAssetId(weth);
        uint256 assetIdUint = uint256(assetId);

        assertLt(assetIdUint, BN254_FIELD_MODULUS, "v2 asset ID exceeds field prime");
        assertEq(assetIdUint >> 248, 0, "v2 asset ID MSB must be zero");
    }

    function test_V2AssetIdFormulaMatchesCanonical() public {
        vm.prank(owner);
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);

        address token = address(0);

        // Compute expected v2 asset ID manually
        bytes memory prefix = bytes("white:asset_id:v2");
        bytes memory input = abi.encodePacked(prefix, DOMAIN_BASE_SEPOLIA, token);
        bytes32 hash = keccak256(input);
        bytes32 expected = bytes32(uint256(hash) >> 8);

        vm.prank(owner);
        assetRegistry.addAsset(token, false, 18, 0.001 ether, 100 ether);

        bytes32 actual = assetRegistry.getAssetId(token);
        assertEq(actual, expected, "v2 Asset ID formula mismatch");
    }

    function test_V2AssetIdDiffersFromV1() public {
        address token = address(0xABC);

        // Deploy two registries with same owner
        vm.prank(owner);
        AssetRegistry v1Registry = new AssetRegistry(owner);
        vm.prank(owner);
        AssetRegistry v2Registry = new AssetRegistry(owner);

        vm.prank(owner);
        v1Registry.addAsset(token, false, 18, 1, 1000000);

        vm.prank(owner);
        v2Registry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);
        vm.prank(owner);
        v2Registry.addAsset(token, false, 18, 1, 1000000);

        bytes32 v1Id = v1Registry.getAssetId(token);
        bytes32 v2Id = v2Registry.getAssetId(token);

        assertTrue(v1Id != v2Id, "v1 and v2 asset IDs must differ");
    }

    function test_V2AssetIdDiffersAcrossDomains() public {
        address token = address(0xABC);
        uint32 domainA = 0x02000002; // Base Sepolia
        uint32 domainB = 0x02000003; // Ethereum Sepolia

        vm.prank(owner);
        AssetRegistry registryA = new AssetRegistry(owner);
        vm.prank(owner);
        AssetRegistry registryB = new AssetRegistry(owner);

        vm.prank(owner);
        registryA.configureDomain(domainA, 2);
        vm.prank(owner);
        registryA.addAsset(token, false, 18, 1, 1000000);

        vm.prank(owner);
        registryB.configureDomain(domainB, 2);
        vm.prank(owner);
        registryB.addAsset(token, false, 18, 1, 1000000);

        bytes32 idA = registryA.getAssetId(token);
        bytes32 idB = registryB.getAssetId(token);

        assertTrue(idA != idB, "Same token on different domains must have different asset IDs");
    }

    function test_ConfigureDomainEmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false);
        emit DomainConfigured(DOMAIN_BASE_SEPOLIA, 2);
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);
    }

    function test_ConfigureDomainOnlyOnce() public {
        vm.prank(owner);
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);

        vm.prank(owner);
        vm.expectRevert("Domain already configured");
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);
    }

    function test_ConfigureDomainOnlyOwner() public {
        vm.prank(address(0xDEAD));
        vm.expectRevert();
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);
    }

    function test_ConfigureDomainInvalidVersion() public {
        vm.prank(owner);
        vm.expectRevert("Invalid version");
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 3);
    }

    function test_V2RegistryStateAfterConfigure() public {
        vm.prank(owner);
        assetRegistry.configureDomain(DOMAIN_BASE_SEPOLIA, 2);

        assertEq(assetRegistry.domainId(), DOMAIN_BASE_SEPOLIA);
        assertEq(assetRegistry.assetIdVersion(), 2);
        assertFalse(assetRegistry.isLegacyV1());
    }
}
