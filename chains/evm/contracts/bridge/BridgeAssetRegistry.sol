// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Maps local asset addresses to canonical asset IDs.
/// Canonical IDs (must match across all chains):
///   1  = ETH-equivalent (WETH)
///   2  = USDC
///   3  = USDT
///   10 = POL/MATIC
///   11 = BNB
contract BridgeAssetRegistry is Ownable {
    mapping(address => uint32) public localToCanonical;
    mapping(uint32 => address) public canonicalToLocal;

    event AssetMapped(address indexed local, uint32 indexed canonical);
    event AssetUnmapped(address indexed local, uint32 indexed canonical);

    error AssetAlreadyMapped();
    error AssetNotMapped();
    error CanonicalAlreadyAssigned();
    error InvalidCanonical();
    error ZeroAddress();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function setMapping(address local, uint32 canonical) external onlyOwner {
        if (local == address(0)) revert ZeroAddress();
        if (canonical == 0) revert InvalidCanonical();
        if (localToCanonical[local] != 0) revert AssetAlreadyMapped();
        if (canonicalToLocal[canonical] != address(0)) revert CanonicalAlreadyAssigned();
        localToCanonical[local] = canonical;
        canonicalToLocal[canonical] = local;
        emit AssetMapped(local, canonical);
    }

    function removeMapping(address local) external onlyOwner {
        uint32 canonical = localToCanonical[local];
        if (canonical == 0) revert AssetNotMapped();
        delete localToCanonical[local];
        delete canonicalToLocal[canonical];
        emit AssetUnmapped(local, canonical);
    }

    function isSupported(address local) external view returns (bool) {
        return localToCanonical[local] != 0;
    }
}
