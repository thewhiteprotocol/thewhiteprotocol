// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AssetRegistry
 * @notice Manages supported assets (tokens) for The White Protocol
 * @dev Supports both v1 (legacy) and v2 (domain-separated) asset ID formulas.
 *      v1: 0x00 || keccak256("white:asset_id:v1" || token)[0..31]
 *      v2: 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || token)[0..31]
 */
contract AssetRegistry is Ownable {
    // Asset info
    struct Asset {
        bool isSupported;
        bool isYieldAsset;
        uint8 decimals;
        uint256 minDeposit;
        uint256 maxDeposit;
    }

    // Mapping from token address to asset info
    mapping(address => Asset) public assets;
    
    // List of supported assets (for iteration)
    address[] public supportedAssets;
    
    // Asset ID mapping (canonical field-safe asset ID)
    mapping(address => bytes32) public assetIds;

    // Protocol domain ID (uint32: high byte = chain family, low 3 bytes = network ID)
    uint32 public domainId;

    // Asset ID formula version (1 = v1 legacy, 2 = v2 domain-separated)
    uint8 public assetIdVersion;

    // Whether this registry is in legacy v1 mode (allows one-time domain configuration)
    bool public isLegacyV1;

    event AssetAdded(address indexed token, bool isYieldAsset);
    event AssetRemoved(address indexed token);
    event AssetUpdated(address indexed token, bool isSupported);
    event DomainConfigured(uint32 domainId, uint8 assetIdVersion);

    constructor(address initialOwner) Ownable(initialOwner) {
        // Default to v1 for backward compatibility with existing tests/deployments.
        domainId = 0;
        assetIdVersion = 1;
        isLegacyV1 = true;
    }

    /**
     * @notice Configure domain and asset ID version for this registry.
     * @dev Can only be called once when in legacy v1 mode. After configuration,
     *      the registry switches to the specified version (typically v2) and
     *      cannot be reconfigured.
     * @param _domainId Protocol domain ID (e.g. 0x02000002 for Base Sepolia)
     * @param _version Asset ID version (1 or 2)
     */
    function configureDomain(uint32 _domainId, uint8 _version) external onlyOwner {
        require(isLegacyV1, "Domain already configured");
        require(_version == 1 || _version == 2, "Invalid version");
        domainId = _domainId;
        assetIdVersion = _version;
        isLegacyV1 = false;
        emit DomainConfigured(_domainId, _version);
    }

    /**
     * @notice Add a new supported asset
     * @param token The token contract address
     * @param _isYieldAsset Whether this is a yield-bearing asset (LST)
     * @param decimals Token decimals
     * @param minDeposit Minimum deposit amount
     * @param maxDeposit Maximum deposit amount
     */
    function addAsset(
        address token,
        bool _isYieldAsset,
        uint8 decimals,
        uint256 minDeposit,
        uint256 maxDeposit
    ) external onlyOwner {
        // Allow address(0) for ETH
        // require(token != address(0), "Invalid token address");
        require(!assets[token].isSupported, "Asset already supported");
        
        assets[token] = Asset({
            isSupported: true,
            isYieldAsset: _isYieldAsset,
            decimals: decimals,
            minDeposit: minDeposit,
            maxDeposit: maxDeposit
        });
        
        if (assetIdVersion == 1) {
            assetIds[token] = _computeAssetIdV1(token);
        } else {
            assetIds[token] = _computeAssetIdV2(token, domainId);
        }
        supportedAssets.push(token);
        
        emit AssetAdded(token, _isYieldAsset);
    }

    /**
     * @notice Remove an asset from supported list
     * @param token The token to remove
     */
    function removeAsset(address token) external onlyOwner {
        require(assets[token].isSupported, "Asset not supported");
        
        assets[token].isSupported = false;
        
        // Remove from supportedAssets array (swap and pop)
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == token) {
                supportedAssets[i] = supportedAssets[supportedAssets.length - 1];
                supportedAssets.pop();
                break;
            }
        }
        
        emit AssetRemoved(token);
    }

    /**
     * @notice Check if an asset is supported
     */
    function isSupported(address token) external view returns (bool) {
        return assets[token].isSupported;
    }

    /**
     * @notice Check if asset is a yield asset
     */
    function isYieldAsset(address token) external view returns (bool) {
        return assets[token].isYieldAsset;
    }

    /**
     * @notice Get asset ID (canonical field-safe asset ID)
     * @dev Returns a BN254 field element.
     */
    function getAssetId(address token) external view returns (bytes32) {
        return assetIds[token];
    }

    /**
     * @notice Compute v1 asset ID from token address (legacy)
     * @dev Matches TypeScript/core formula:
     *      0x00 || keccak256("white:asset_id:v1" || token)[0..31]
     *      This ensures the result is always < 2^248, well within BN254 field prime.
     */
    function _computeAssetIdV1(address token) internal pure returns (bytes32) {
        bytes memory prefix = bytes("white:asset_id:v1");
        bytes memory input = abi.encodePacked(prefix, token);
        bytes32 hash = keccak256(input);
        // Drop the least significant byte (shift right by 8 bits)
        // Result: 0x00 || hash[0..30]
        return bytes32(uint256(hash) >> 8);
    }

    /**
     * @notice Compute v2 asset ID from token address with domain separation
     * @dev Matches TypeScript/core formula:
     *      0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || token)[0..31]
     */
    function _computeAssetIdV2(address token, uint32 _domainId) internal pure returns (bytes32) {
        bytes memory prefix = bytes("white:asset_id:v2");
        bytes memory input = abi.encodePacked(prefix, _domainId, token);
        bytes32 hash = keccak256(input);
        return bytes32(uint256(hash) >> 8);
    }

    /**
     * @notice Get all supported assets
     */
    function getSupportedAssets() external view returns (address[] memory) {
        return supportedAssets;
    }

    /**
     * @notice Get number of supported assets
     */
    function getAssetCount() external view returns (uint256) {
        return supportedAssets.length;
    }
}
