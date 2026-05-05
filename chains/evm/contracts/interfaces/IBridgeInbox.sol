// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BridgeMessageLib } from "../libraries/BridgeMessageLib.sol";

/**
 * @title IBridgeInbox
 * @notice Interface for the destination-chain bridge inbox.
 */
interface IBridgeInbox {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event BridgeMintAccepted(
        bytes32 indexed messageHash,
        bytes32 indexed destinationCommitment,
        bytes32 indexed canonicalAssetId,
        uint128 amount,
        uint64 nonce
    );
    event SignerSetUpdated(uint256 indexed version, uint256 threshold);
    event InboxRouteEnabled(uint32 indexed sourceDomain);
    event InboxRouteDisabled(uint32 indexed sourceDomain);
    event InflowCapUpdated(bytes32 indexed canonicalAssetId, uint128 cap);
    event MaxMessageAmountUpdated(bytes32 indexed canonicalAssetId, uint128 max);
    event AssetSupported(bytes32 indexed canonicalAssetId);
    event AssetUnsupported(bytes32 indexed canonicalAssetId);
    event GlobalPauseUpdated(bool paused);
    event InboxRoutePauseUpdated(uint32 indexed sourceDomain, uint32 indexed destinationDomain, bool paused);
    event MessageFrozen(bytes32 indexed messageHash);
    event MessageUnfrozen(bytes32 indexed messageHash);
    event DailyInflowCapUpdated(bytes32 indexed canonicalAssetId, uint128 cap);

    // -------------------------------------------------------------------------
    // Functions
    // -------------------------------------------------------------------------
    function acceptBridgeMint(
        BridgeMessageLib.BridgeMessageV1 calldata message,
        bytes[] calldata signatures,
        uint256 signerSetVersion
    ) external;

    function updateSignerSet(address[] calldata signers, uint256 threshold) external;
    function enableRoute(uint32 sourceDomain) external;
    function disableRoute(uint32 sourceDomain) external;
    function setInflowCap(bytes32 canonicalAssetId, uint128 cap) external;
    function setDailyInflowCap(bytes32 canonicalAssetId, uint128 cap) external;
    function setGlobalDailyCap(uint128 cap) external;
    function setMaxMessageAmount(bytes32 canonicalAssetId, uint128 max) external;
    function supportAsset(bytes32 canonicalAssetId) external;
    function unsupportAsset(bytes32 canonicalAssetId) external;
    function setWhiteProtocol(address _whiteProtocol) external;
    function setLocalAsset(bytes32 canonicalAssetId, address localAsset) external;
    function setGlobalPaused(bool paused) external;
    function setRoutePaused(uint32 sourceDomain, uint32 destinationDomain, bool paused) external;
    function freezeMessage(bytes32 messageHash) external;
    function unfreezeMessage(bytes32 messageHash) external;

    function localDomain() external view returns (uint32);
    function currentSignerSetVersion() external view returns (uint256);
    function isRouteEnabled(uint32 sourceDomain) external view returns (bool);
    function isAssetSupported(bytes32 canonicalAssetId) external view returns (bool);
    function globalPaused() external view returns (bool);
    function isRoutePaused(uint32 sourceDomain, uint32 destinationDomain) external view returns (bool);
    function isMessageFrozen(bytes32 messageHash) external view returns (bool);
    function isMessageConsumed(bytes32 messageHash) external view returns (bool);
    function inflowCap(bytes32 canonicalAssetId) external view returns (uint128);
    function dailyInflowCap(bytes32 canonicalAssetId) external view returns (uint128);
    function globalDailyCap() external view returns (uint128);
    function maxMessageAmount(bytes32 canonicalAssetId) external view returns (uint128);
}
