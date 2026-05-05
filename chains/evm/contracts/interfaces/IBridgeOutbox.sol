// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BridgeMessageLib } from "../libraries/BridgeMessageLib.sol";

/**
 * @title IBridgeOutbox
 * @notice Interface for the source-chain bridge outbox.
 */
interface IBridgeOutbox {
    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event BridgeOutInitiated(
        bytes32 indexed messageHash,
        uint32 indexed destinationDomain,
        bytes32 indexed canonicalAssetId,
        uint128 amount,
        uint64 nonce,
        bytes encodedMessage
    );
    event RouteEnabled(uint32 indexed destinationDomain);
    event RouteDisabled(uint32 indexed destinationDomain);
    event OutboundNonceUpdated(uint32 indexed destinationDomain, uint64 nonce);
    event OutflowCapUpdated(bytes32 indexed canonicalAssetId, uint128 cap);
    event MaxMessageAmountUpdated(bytes32 indexed canonicalAssetId, uint128 max);
    event AssetSupported(bytes32 indexed canonicalAssetId);
    event AssetUnsupported(bytes32 indexed canonicalAssetId);
    event GlobalPauseUpdated(bool paused);
    event RoutePauseUpdated(uint32 indexed sourceDomain, uint32 indexed destinationDomain, bool paused);
    event DailyOutflowCapUpdated(bytes32 indexed canonicalAssetId, uint128 cap);

    // -------------------------------------------------------------------------
    // Functions
    // -------------------------------------------------------------------------
    function initBridgeOut(BridgeMessageLib.BridgeMessageV1 calldata message) external;
    function initBridgeOutFromProtocol(BridgeMessageLib.BridgeMessageV1 calldata message) external;
    function enableRoute(uint32 destinationDomain) external;
    function disableRoute(uint32 destinationDomain) external;
    function setOutflowCap(bytes32 canonicalAssetId, uint128 cap) external;
    function setDailyOutflowCap(bytes32 canonicalAssetId, uint128 cap) external;
    function setMaxMessageAmount(bytes32 canonicalAssetId, uint128 max) external;
    function supportAsset(bytes32 canonicalAssetId) external;
    function unsupportAsset(bytes32 canonicalAssetId) external;
    function setGlobalPaused(bool paused) external;
    function setRoutePaused(uint32 sourceDomain, uint32 destinationDomain, bool paused) external;

    function localDomain() external view returns (uint32);
    function isRouteEnabled(uint32 destinationDomain) external view returns (bool);
    function isAssetSupported(bytes32 canonicalAssetId) external view returns (bool);
    function globalPaused() external view returns (bool);
    function isRoutePaused(uint32 sourceDomain, uint32 destinationDomain) external view returns (bool);
    function outflowCap(bytes32 canonicalAssetId) external view returns (uint128);
    function dailyOutflowCap(bytes32 canonicalAssetId) external view returns (uint128);
    function maxMessageAmount(bytes32 canonicalAssetId) external view returns (uint128);
    function outboundNonce(uint32 destinationDomain) external view returns (uint64);
    function outboundMessageHashRecorded(bytes32 messageHash) external view returns (bool);
}
