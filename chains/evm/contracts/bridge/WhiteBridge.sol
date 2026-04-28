// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { OApp, MessagingFee, MessagingReceipt, Origin } from "@layerzerolabs/oapp-evm/contracts/oapp/OApp.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { BridgeAssetRegistry } from "./BridgeAssetRegistry.sol";

interface IWhiteProtocolBridge {
    function bridgeWithdraw(
        bytes calldata proof,
        bytes32 nullifierHash,
        address asset,
        uint256 amount,
        bytes32 extDataHash
    ) external;

    function bridgeMint(
        address asset,
        uint256 amount,
        bytes32 newCommitment
    ) external;
}

contract WhiteBridge is OApp, ReentrancyGuard {
    struct BridgeMessage {
        uint32 canonicalAsset;
        uint256 amount;
        bytes32 newCommitment;
        uint64 sourceNonce;
    }

    struct ParkedMessage {
        uint32 srcEid;
        uint32 canonical;
        uint256 amount;
        bytes32 commitment;
        uint64 parkedAt;
    }

    IWhiteProtocolBridge public immutable whiteProtocol;
    BridgeAssetRegistry public bridgeAssetRegistry;

    mapping(address => uint256) public maxOutflow;
    mapping(address => uint256) public maxInflow;
    mapping(address => uint256) public totalOutflow;
    mapping(address => uint256) public totalInflow;
    mapping(bytes32 => ParkedMessage) public parkedMessages;

    uint64 public localNonce;

    event BridgeOut(
        address indexed sender,
        uint32 indexed dstEid,
        uint32 indexed canonicalAsset,
        uint256 amount,
        bytes32 newCommitment,
        bytes32 guid
    );
    event BridgeIn(
        uint32 indexed srcEid,
        uint32 indexed canonicalAsset,
        uint256 amount,
        bytes32 indexed newCommitment,
        bytes32 guid
    );
    event BridgeInParked(bytes32 indexed guid, uint32 srcEid, uint32 canonical, uint256 amount);
    event RecoveryExecuted(bytes32 indexed guid);
    event OutflowCapSet(address indexed asset, uint256 cap);
    event InflowCapSet(address indexed asset, uint256 cap);
    event RegistrySet(address indexed registry);

    error UnsupportedAsset();
    error UnsupportedDestination();
    error UnknownCanonicalAsset();
    error OutflowCapExceeded();
    error NoParkedMessage();
    error StillOverCap();
    error ZeroAddress();
    error AmountZero();
    error InvalidMessageLength();
    error AmountOverflow();

    constructor(
        address _endpoint,
        address _delegate,
        address _whiteProtocol,
        address _registry
    ) OApp(_endpoint, _delegate) {
        if (_whiteProtocol == address(0) || _registry == address(0)) revert ZeroAddress();
        whiteProtocol = IWhiteProtocolBridge(_whiteProtocol);
        bridgeAssetRegistry = BridgeAssetRegistry(_registry);
    }

    function setBridgeAssetRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert ZeroAddress();
        bridgeAssetRegistry = BridgeAssetRegistry(_registry);
        emit RegistrySet(_registry);
    }

    function setOutflowCap(address asset, uint256 cap) external onlyOwner {
        maxOutflow[asset] = cap;
        emit OutflowCapSet(asset, cap);
    }

    function setInflowCap(address asset, uint256 cap) external onlyOwner {
        maxInflow[asset] = cap;
        emit InflowCapSet(asset, cap);
    }

    function quoteBridgeOut(
        uint32 dstEid,
        address asset,
        uint256 amount,
        bytes32 newCommitment,
        bytes calldata lzOptions
    ) external view returns (MessagingFee memory) {
        uint32 canonical = bridgeAssetRegistry.localToCanonical(asset);
        if (canonical == 0) revert UnsupportedAsset();
        if (amount > type(uint64).max) revert AmountOverflow();
        BridgeMessage memory bm = BridgeMessage(canonical, amount, newCommitment, 0);
        return _quote(dstEid, _encodeBridgeMessage(bm), lzOptions, false);
    }

    function bridgeOut(
        bytes calldata proof,
        bytes32 nullifierHash,
        address asset,
        uint256 amount,
        uint32 dstEid,
        bytes32 newCommitment,
        bytes calldata lzOptions
    ) external payable nonReentrant returns (MessagingReceipt memory receipt) {
        if (amount == 0) revert AmountZero();
        uint32 canonical = bridgeAssetRegistry.localToCanonical(asset);
        if (canonical == 0) revert UnsupportedAsset();
        if (peers[dstEid] == bytes32(0)) revert UnsupportedDestination();
        if (totalOutflow[asset] + amount > maxOutflow[asset]) revert OutflowCapExceeded();

        bytes32 extDataHash = keccak256(abi.encode(dstEid, newCommitment, canonical, amount));
        whiteProtocol.bridgeWithdraw(proof, nullifierHash, asset, amount, extDataHash);

        totalOutflow[asset] += amount;

        if (amount > type(uint64).max) revert AmountOverflow();

        BridgeMessage memory bm = BridgeMessage({
            canonicalAsset: canonical,
            amount: amount,
            newCommitment: newCommitment,
            sourceNonce: ++localNonce
        });

        bytes memory payload = _encodeBridgeMessage(bm);
        MessagingFee memory fee = MessagingFee(msg.value, 0);

        receipt = _lzSend(dstEid, payload, lzOptions, fee, payable(msg.sender));

        emit BridgeOut(msg.sender, dstEid, canonical, amount, newCommitment, receipt.guid);
    }

    function _lzReceive(
        Origin calldata _origin,
        bytes32 _guid,
        bytes calldata _message,
        address /*_executor*/,
        bytes calldata /*_extraData*/
    ) internal override {
        BridgeMessage memory bm = _decodeBridgeMessage(_message);
        address localAsset = bridgeAssetRegistry.canonicalToLocal(bm.canonicalAsset);
        if (localAsset == address(0)) revert UnknownCanonicalAsset();

        if (totalInflow[localAsset] + bm.amount > maxInflow[localAsset]) {
            parkedMessages[_guid] = ParkedMessage({
                srcEid: _origin.srcEid,
                canonical: bm.canonicalAsset,
                amount: bm.amount,
                commitment: bm.newCommitment,
                parkedAt: uint64(block.timestamp)
            });
            emit BridgeInParked(_guid, _origin.srcEid, bm.canonicalAsset, bm.amount);
            return;
        }

        totalInflow[localAsset] += bm.amount;
        whiteProtocol.bridgeMint(localAsset, bm.amount, bm.newCommitment);
        emit BridgeIn(_origin.srcEid, bm.canonicalAsset, bm.amount, bm.newCommitment, _guid);
    }

    function executeRecovery(bytes32 guid) external nonReentrant {
        ParkedMessage memory pm = parkedMessages[guid];
        if (pm.parkedAt == 0) revert NoParkedMessage();
        address localAsset = bridgeAssetRegistry.canonicalToLocal(pm.canonical);
        if (localAsset == address(0)) revert UnknownCanonicalAsset();
        if (totalInflow[localAsset] + pm.amount > maxInflow[localAsset]) revert StillOverCap();

        totalInflow[localAsset] += pm.amount;
        whiteProtocol.bridgeMint(localAsset, pm.amount, pm.commitment);
        delete parkedMessages[guid];
        emit RecoveryExecuted(guid);
    }

    // ---------------------------------------------------------------------------
    // Compact 52-byte wire format codec
    // canonicalAsset (4 bytes BE) || amount (8 bytes BE) || newCommitment (32 bytes) || sourceNonce (8 bytes BE)
    // ---------------------------------------------------------------------------

    function _encodeBridgeMessage(BridgeMessage memory bm) internal pure returns (bytes memory) {
        return abi.encodePacked(
            bm.canonicalAsset, // 4 bytes
            uint64(bm.amount), // 8 bytes
            bm.newCommitment,  // 32 bytes
            bm.sourceNonce     // 8 bytes
        );
    }

    function _decodeBridgeMessage(bytes calldata _message) internal pure returns (BridgeMessage memory bm) {
        if (_message.length != 52) revert InvalidMessageLength();
        bm.canonicalAsset = uint32(bytes4(_message[0:4]));
        bm.amount = uint256(uint64(bytes8(_message[4:12])));
        bm.newCommitment = bytes32(_message[12:44]);
        bm.sourceNonce = uint64(bytes8(_message[44:52]));
    }
}
