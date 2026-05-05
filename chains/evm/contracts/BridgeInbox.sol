// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BridgeMessageLib } from "./libraries/BridgeMessageLib.sol";
import { BridgeAttestationLib } from "./libraries/BridgeAttestationLib.sol";
import { IBridgeInbox } from "./interfaces/IBridgeInbox.sol";
import { IWhiteProtocolBridge } from "./interfaces/IWhiteProtocolBridge.sol";

/**
 * @title BridgeInbox
 * @notice Destination-chain bridge inbox for The White Protocol Private Bridge v1.
 *
 * Responsibilities:
 * - Verify threshold ECDSA signatures on bridge messages.
 * - Validate message fields (domains, routes, assets, deadlines, caps).
 * - Track consumed message hashes (replay protection).
 * - Emit BridgeMintAccepted events for downstream commitment insertion.
 *
 * Does NOT call WhiteProtocol.bridgeMint directly. In production,
 * the bridge-mint flow is:
 *   1. Relayer submits message + signatures to BridgeInbox.acceptBridgeMint.
 *   2. BridgeInbox verifies and emits BridgeMintAccepted.
 *   3. A separate minter (or future integration) reads the event and inserts
 *      the commitment into WhiteProtocol's Merkle tree.
 *
 * For PR-010C, actual WhiteProtocol.commitment insertion is intentionally deferred.
 */
contract BridgeInbox is IBridgeInbox, Ownable, ReentrancyGuard {
    // =========================================================================
    // Errors
    // =========================================================================

    error InvalidDestinationDomain();
    error SameDomain();
    error RouteNotEnabled(uint32 sourceDomain);
    error AssetNotSupported();
    error AmountZero();
    error MaxMessageAmountExceeded();
    error DailyInflowCapExceeded();
    error GlobalDailyCapExceeded();
    error GlobalPaused();
    error RoutePaused();
    error MessageIsFrozen();
    error DeadlineExpired();
    error MessageAlreadyConsumed();
    error InvalidSignerSetVersion();
    error InvalidThreshold();
    error ZeroSigner();
    error DuplicateSigner();
    error ThresholdNotMet();
    error InvalidSignature();
    error SignaturesNotSorted();
    error InvalidSigner();
    error LocalAssetNotSet();

    // =========================================================================
    // State
    // =========================================================================

    uint32 public immutable localDomain;

    bool public globalPaused;
    uint128 public globalDailyCap;

    // Signer sets by version
    mapping(uint256 => BridgeAttestationLib.SignerSet) public signerSets;
    uint256 public currentSignerSetVersion;

    mapping(uint32 => bool) public isRouteEnabled;
    mapping(uint32 => mapping(uint32 => bool)) public isRoutePaused;
    mapping(bytes32 => bool) public isAssetSupported;
    mapping(bytes32 => uint128) public inflowCap;
    mapping(bytes32 => uint128) public dailyInflowCap;
    mapping(bytes32 => uint128) public maxMessageAmount;
    mapping(bytes32 => bool) public consumedMessageHashes;
    mapping(bytes32 => bool) public frozenMessages;

    /// WhiteProtocol reference for commitment insertion
    IWhiteProtocolBridge public whiteProtocol;

    /// Canonical asset ID => local token address
    mapping(bytes32 => address) public canonicalToLocalAsset;
    mapping(bytes32 => bool) public isLocalAssetSet;

    // dailyInflowUsed[canonicalAssetId][day] = amount used
    mapping(bytes32 => mapping(uint256 => uint128)) public dailyInflowUsed;
    // globalDailyUsed[day] = total inflow
    mapping(uint256 => uint128) public globalDailyUsed;

    // =========================================================================
    // Constructor
    // =========================================================================

    constructor(address initialOwner, uint32 _localDomain) Ownable(initialOwner) {
        localDomain = _localDomain;
    }

    // =========================================================================
    // Bridge Mint Acceptance
    // =========================================================================

    /**
     * @notice Accept a bridge-mint message with threshold signatures.
     * @dev Verifies attestation, validates message, checks caps, marks consumed.
     */
    function acceptBridgeMint(
        BridgeMessageLib.BridgeMessageV1 calldata message,
        bytes[] calldata signatures,
        uint256 signerSetVersion
    ) external override nonReentrant {
        if (globalPaused) revert GlobalPaused();
        if (message.destinationDomain != localDomain) revert InvalidDestinationDomain();
        if (message.sourceDomain == message.destinationDomain) revert SameDomain();
        if (!isRouteEnabled[message.sourceDomain]) revert RouteNotEnabled(message.sourceDomain);
        if (isRoutePaused[message.sourceDomain][message.destinationDomain]) revert RoutePaused();
        if (!isAssetSupported[message.canonicalAssetId]) revert AssetNotSupported();
        if (message.amount == 0) revert AmountZero();
        if (message.deadline < block.timestamp) revert DeadlineExpired();

        bytes32 messageHash = BridgeMessageLib.hashMessage(message);
        if (consumedMessageHashes[messageHash]) revert MessageAlreadyConsumed();
        if (frozenMessages[messageHash]) revert MessageIsFrozen();

        // Threshold signature verification
        if (signerSetVersion != currentSignerSetVersion) revert InvalidSignerSetVersion();
        BridgeAttestationLib.SignerSet storage set = signerSets[signerSetVersion];
        BridgeAttestationLib.verifyThresholdSignatures(messageHash, signatures, set);

        // Max message amount check
        uint128 msgMax = maxMessageAmount[message.canonicalAssetId];
        if (msgMax > 0 && message.amount > msgMax) revert MaxMessageAmountExceeded();

        // Daily inflow cap per asset
        uint256 day = block.timestamp / 1 days;
        uint128 assetDailyCap = dailyInflowCap[message.canonicalAssetId];
        if (assetDailyCap > 0) {
            uint128 newAssetUsed = dailyInflowUsed[message.canonicalAssetId][day] + message.amount;
            if (newAssetUsed > assetDailyCap) revert DailyInflowCapExceeded();
            dailyInflowUsed[message.canonicalAssetId][day] = newAssetUsed;
        }

        // Global daily cap
        if (globalDailyCap > 0) {
            uint128 newGlobalUsed = globalDailyUsed[day] + message.amount;
            if (newGlobalUsed > globalDailyCap) revert GlobalDailyCapExceeded();
            globalDailyUsed[day] = newGlobalUsed;
        }

        // Insert commitment into WhiteProtocol Merkle tree
        if (!isLocalAssetSet[message.canonicalAssetId]) revert LocalAssetNotSet();
        address localAsset = canonicalToLocalAsset[message.canonicalAssetId];
        whiteProtocol.bridgeMint(localAsset, message.amount, message.destinationCommitment);

        // Mark consumed
        consumedMessageHashes[messageHash] = true;

        emit BridgeMintAccepted(
            messageHash,
            message.destinationCommitment,
            message.canonicalAssetId,
            message.amount,
            message.nonce
        );
    }

    // =========================================================================
    // Admin: WhiteProtocol Integration
    // =========================================================================

    function setWhiteProtocol(address _whiteProtocol) external override onlyOwner {
        whiteProtocol = IWhiteProtocolBridge(_whiteProtocol);
    }

    function setLocalAsset(bytes32 canonicalAssetId, address localAsset) external override onlyOwner {
        canonicalToLocalAsset[canonicalAssetId] = localAsset;
        isLocalAssetSet[canonicalAssetId] = true;
    }

    // =========================================================================
    // Admin: Signer Set
    // =========================================================================

    function updateSignerSet(address[] calldata signers, uint256 threshold)
        external
        override
        onlyOwner
    {
        BridgeAttestationLib.validateSignerSet(signers, threshold);

        uint256 newVersion = currentSignerSetVersion + 1;
        currentSignerSetVersion = newVersion;

        BridgeAttestationLib.SignerSet storage set = signerSets[newVersion];
        set.signers = signers;
        set.threshold = threshold;
        set.version = newVersion;

        emit SignerSetUpdated(newVersion, threshold);
    }

    // =========================================================================
    // Admin: Route Management
    // =========================================================================

    function enableRoute(uint32 sourceDomain) external override onlyOwner {
        isRouteEnabled[sourceDomain] = true;
        emit IBridgeInbox.InboxRouteEnabled(sourceDomain);
    }

    function disableRoute(uint32 sourceDomain) external override onlyOwner {
        isRouteEnabled[sourceDomain] = false;
        emit IBridgeInbox.InboxRouteDisabled(sourceDomain);
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

    function setInflowCap(bytes32 canonicalAssetId, uint128 cap) external override onlyOwner {
        inflowCap[canonicalAssetId] = cap;
        emit InflowCapUpdated(canonicalAssetId, cap);
    }

    function setDailyInflowCap(bytes32 canonicalAssetId, uint128 cap) external override onlyOwner {
        dailyInflowCap[canonicalAssetId] = cap;
        emit DailyInflowCapUpdated(canonicalAssetId, cap);
    }

    function setGlobalDailyCap(uint128 cap) external override onlyOwner {
        globalDailyCap = cap;
        emit DailyInflowCapUpdated(bytes32(0), cap);
    }

    function setMaxMessageAmount(bytes32 canonicalAssetId, uint128 max) external override onlyOwner {
        maxMessageAmount[canonicalAssetId] = max;
        emit MaxMessageAmountUpdated(canonicalAssetId, max);
    }

    // =========================================================================
    // Admin: Pause / Freeze
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
        emit IBridgeInbox.InboxRoutePauseUpdated(sourceDomain, destinationDomain, paused);
    }

    function freezeMessage(bytes32 messageHash) external override onlyOwner {
        frozenMessages[messageHash] = true;
        emit MessageFrozen(messageHash);
    }

    function unfreezeMessage(bytes32 messageHash) external override onlyOwner {
        frozenMessages[messageHash] = false;
        emit MessageUnfrozen(messageHash);
    }

    // =========================================================================
    // Views
    // =========================================================================

    function isMessageFrozen(bytes32 messageHash) external view override returns (bool) {
        return frozenMessages[messageHash];
    }

    function isMessageConsumed(bytes32 messageHash) external view override returns (bool) {
        return consumedMessageHashes[messageHash];
    }
}
