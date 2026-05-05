// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BridgeMessageLib } from "./libraries/BridgeMessageLib.sol";
import { IBridgeOutbox } from "./interfaces/IBridgeOutbox.sol";

/**
 * @title BridgeOutbox
 * @notice Source-chain bridge outbox for The White Protocol Private Bridge v1.
 *
 * Responsibilities:
 * - Validate and record outbound bridge messages.
 * - Emit BridgeOutInitiated events for relayers/signers.
 * - Enforce route enabled, asset supported, pause, and cap checks.
 * - Track outbound nonces per destination domain.
 *
 * Does NOT call WhiteProtocol.bridgeWithdraw directly. In production,
 * the bridge-out flow is:
 *   1. User calls WhiteProtocol.bridgeWithdraw (spends note).
 *   2. WhiteProtocol (or a separate coordinator) calls initBridgeOut with the message.
 *
 * For PR-010C tests, initBridgeOut is called directly with a prebuilt message.
 */
contract BridgeOutbox is IBridgeOutbox, Ownable, ReentrancyGuard {
    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidSourceDomain();
    error SameDomain();
    error RouteNotEnabled(uint32 destinationDomain);
    error AssetNotSupported();
    error AmountZero();
    error MaxMessageAmountExceeded();
    error DailyOutflowCapExceeded();
    error GlobalPaused();
    error RoutePaused();
    error InvalidDeadline();
    error NonceMismatch();
    error AlreadyRecorded();
    error OnlyWhiteProtocol();
    error Unauthorized();

    // =========================================================================
    // State
    // =========================================================================

    uint32 public immutable localDomain;

    address public whiteProtocol;

    bool public globalPaused;

    mapping(uint32 => bool) public isRouteEnabled;
    mapping(uint32 => mapping(uint32 => bool)) public isRoutePaused;
    mapping(bytes32 => bool) public isAssetSupported;
    mapping(bytes32 => uint128) public outflowCap;
    mapping(bytes32 => uint128) public dailyOutflowCap;
    mapping(bytes32 => uint128) public maxMessageAmount;
    mapping(uint32 => uint64) public outboundNonce;
    mapping(bytes32 => bool) public outboundMessageHashRecorded;

    // dailyOutflowUsed[canonicalAssetId][day] = amount used
    mapping(bytes32 => mapping(uint256 => uint128)) public dailyOutflowUsed;

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address initialOwner, uint32 _localDomain) Ownable(initialOwner) {
        localDomain = _localDomain;
    }

    event WhiteProtocolSet(address indexed whiteProtocol);

    modifier onlyWhiteProtocol() {
        if (msg.sender != whiteProtocol) revert OnlyWhiteProtocol();
        _;
    }

    function setWhiteProtocol(address _whiteProtocol) external onlyOwner {
        whiteProtocol = _whiteProtocol;
        emit WhiteProtocolSet(_whiteProtocol);
    }

    // =========================================================================
    // Bridge Out
    // =========================================================================

    /**
     * @notice Record a bridge-out message on the source chain — production path.
     * @dev Only callable by the authorized WhiteProtocol contract. Validates the
     *      message, assigns/verifies nonce, checks caps, and emits event.
     */
    function initBridgeOutFromProtocol(BridgeMessageLib.BridgeMessageV1 calldata message)
        external
        override
        nonReentrant
        onlyWhiteProtocol
    {
        _initBridgeOut(message);
    }

    /**
     * @notice Record a bridge-out message on the source chain — test/admin path.
     * @dev In production this is gated to owner/whiteProtocol. Existing tests
     *      that call directly should use owner() as msg.sender.
     */
    function initBridgeOut(BridgeMessageLib.BridgeMessageV1 calldata message)
        external
        override
        nonReentrant
    {
        if (msg.sender != owner() && msg.sender != whiteProtocol) revert Unauthorized();
        _initBridgeOut(message);
    }

    function _initBridgeOut(BridgeMessageLib.BridgeMessageV1 calldata message) internal {
        if (globalPaused) revert GlobalPaused();
        if (message.sourceDomain != localDomain) revert InvalidSourceDomain();
        if (message.destinationDomain == message.sourceDomain) revert SameDomain();
        if (!isRouteEnabled[message.destinationDomain]) revert RouteNotEnabled(message.destinationDomain);
        if (isRoutePaused[message.sourceDomain][message.destinationDomain]) revert RoutePaused();
        if (!isAssetSupported[message.canonicalAssetId]) revert AssetNotSupported();
        if (message.amount == 0) revert AmountZero();
        if (message.deadline < block.timestamp) revert InvalidDeadline();

        // Hash and record (check duplicate BEFORE nonce to avoid nonce manipulation)
        bytes32 messageHash = BridgeMessageLib.hashMessage(message);
        if (outboundMessageHashRecorded[messageHash]) revert AlreadyRecorded();
        outboundMessageHashRecorded[messageHash] = true;

        // Nonce: must match the next expected nonce for this destination
        uint64 expectedNonce = outboundNonce[message.destinationDomain] + 1;
        if (message.nonce != expectedNonce) revert NonceMismatch();
        outboundNonce[message.destinationDomain] = expectedNonce;

        // Max message amount check
        uint128 msgMax = maxMessageAmount[message.canonicalAssetId];
        if (msgMax > 0 && message.amount > msgMax) revert MaxMessageAmountExceeded();

        // Outflow cap check
        uint128 cap = outflowCap[message.canonicalAssetId];
        if (cap > 0) {
            uint256 day = block.timestamp / 1 days;
            uint128 newUsed = dailyOutflowUsed[message.canonicalAssetId][day] + message.amount;
            if (newUsed > cap) revert DailyOutflowCapExceeded();
            dailyOutflowUsed[message.canonicalAssetId][day] = newUsed;
        }

        bytes memory encodedMessage = BridgeMessageLib.encodeMessage(message);

        emit BridgeOutInitiated(
            messageHash,
            message.destinationDomain,
            message.canonicalAssetId,
            message.amount,
            message.nonce,
            encodedMessage
        );
    }

    // =========================================================================
    // Admin: Route Management
    // =========================================================================

    function enableRoute(uint32 destinationDomain) external override onlyOwner {
        isRouteEnabled[destinationDomain] = true;
        emit RouteEnabled(destinationDomain);
    }

    function disableRoute(uint32 destinationDomain) external override onlyOwner {
        isRouteEnabled[destinationDomain] = false;
        emit RouteDisabled(destinationDomain);
    }

    // =========================================================================
    // Admin: Asset Management
    // =========================================================================

    function supportAsset(bytes32 canonicalAssetId) external override onlyOwner {
        isAssetSupported[canonicalAssetId] = true;
        emit AssetSupported(canonicalAssetId);
    }

    function unsupportAsset(bytes32 canonicalAssetId) external override onlyOwner {
        isAssetSupported[canonicalAssetId] = false;
        emit AssetUnsupported(canonicalAssetId);
    }

    // =========================================================================
    // Admin: Caps
    // =========================================================================

    function setOutflowCap(bytes32 canonicalAssetId, uint128 cap) external override onlyOwner {
        outflowCap[canonicalAssetId] = cap;
        emit OutflowCapUpdated(canonicalAssetId, cap);
    }

    function setDailyOutflowCap(bytes32 canonicalAssetId, uint128 cap) external override onlyOwner {
        dailyOutflowCap[canonicalAssetId] = cap;
        emit DailyOutflowCapUpdated(canonicalAssetId, cap);
    }

    function setMaxMessageAmount(bytes32 canonicalAssetId, uint128 max) external override onlyOwner {
        maxMessageAmount[canonicalAssetId] = max;
        emit MaxMessageAmountUpdated(canonicalAssetId, max);
    }

    // =========================================================================
    // Admin: Pause
    // =========================================================================

    function setGlobalPaused(bool paused) external override onlyOwner {
        globalPaused = paused;
        emit GlobalPauseUpdated(paused);
    }

    function setRoutePaused(uint32 sourceDomain, uint32 destinationDomain, bool paused)
        external
        override
        onlyOwner
    {
        isRoutePaused[sourceDomain][destinationDomain] = paused;
        emit RoutePauseUpdated(sourceDomain, destinationDomain, paused);
    }
}
