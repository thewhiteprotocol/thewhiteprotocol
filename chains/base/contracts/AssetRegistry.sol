// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AssetRegistry
 * @notice Manages supported assets (tokens) for The White Protocol
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
    
    // Asset ID mapping (keccak256 hash of address)
    mapping(address => bytes32) public assetIds;

    event AssetAdded(address indexed token, bool isYieldAsset);
    event AssetRemoved(address indexed token);
    event AssetUpdated(address indexed token, bool isSupported);

    constructor(address initialOwner) Ownable(initialOwner) {}

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
        
        assetIds[token] = keccak256(abi.encodePacked(token));
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
     * @notice Get asset ID (keccak256 hash)
     */
    function getAssetId(address token) external view returns (bytes32) {
        return assetIds[token];
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
