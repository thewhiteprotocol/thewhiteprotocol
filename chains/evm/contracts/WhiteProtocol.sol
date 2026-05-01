// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MerkleTreeWithHistory.sol";
import "./AssetRegistry.sol";
import "./IVerifiers.sol";

/**
 * @title WhiteProtocol
 * @notice Main privacy pool contract for The White Protocol on Base
 * @dev Implements deposit, withdraw, and batch settlement with Groth16 proofs
 */
contract WhiteProtocol is MerkleTreeWithHistory, ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // Verifier contracts
    IDepositVerifier public immutable depositVerifier;
    IWithdrawVerifier public immutable withdrawVerifier;
    IMerkleBatchVerifier public immutable merkleBatchVerifier;

    // Asset registry
    AssetRegistry public assetRegistry;

    // Spent nullifiers (prevents double-spend)
    mapping(uint256 => bool) public spentNullifiers;

    // Pending deposits buffer (commitments waiting to be settled)
    uint256[] public pendingDeposits;
    
    // Mapping from commitment hash to pending index
    mapping(uint256 => uint256) public commitmentToPendingIndex;

    // Relayer registry
    mapping(address => bool) public isRelayer;
    mapping(address => uint256) public relayerFees;

    // Bridge hooks
    address public bridge;
    mapping(address => uint256) public bridgeOutgoing;
    mapping(address => uint256) public bridgeIncoming;

    // Protocol domain ID (uint32: high byte = chain family, low 3 bytes = network ID)
    uint32 public domainId;
    bool public domainIdSet;

    // Pool configuration
    uint256 public constant RELAYER_FEE_BPS = 50; // 0.5%
    uint256 public constant YIELD_RELAYER_FEE_BPS = 500; // 5%
    uint256 public constant MAX_FEE_BPS = 1000; // 10%

    // Events
    event Deposit(
        uint256 indexed commitment,
        uint256 amount,
        address indexed asset,
        uint256 leafIndex
    );
    
    event Withdrawal(
        uint256 indexed nullifierHash,
        address indexed recipient,
        address indexed relayer,
        uint256 amount,
        uint256 fee
    );
    
    event StealthWithdrawal(
        bytes ephemeralPubkey,
        address indexed destination,
        uint256 blockNumber
    );
    
    event BatchSettlement(
        uint256 indexed startIndex,
        uint256 batchSize,
        uint256 newRoot
    );
    
    event RelayerRegistered(address indexed relayer);
    event RelayerRemoved(address indexed relayer);

    event BridgeSet(address indexed bridge);
    event BridgeWithdraw(bytes32 indexed nullifierHash, address indexed asset, uint256 amount, bytes32 extDataHash);
    event BridgeMint(address indexed asset, uint256 amount, bytes32 indexed newCommitment);

    error OnlyBridge();
    error BridgeNotSet();
    error NullifierUsed();

    modifier onlyBridge() {
        if (msg.sender != bridge) revert OnlyBridge();
        _;
    }

    constructor(
        address initialOwner,
        address _depositVerifier,
        address _withdrawVerifier,
        address _merkleBatchVerifier,
        address _assetRegistry
    ) Ownable(initialOwner) {
        depositVerifier = IDepositVerifier(_depositVerifier);
        withdrawVerifier = IWithdrawVerifier(_withdrawVerifier);
        merkleBatchVerifier = IMerkleBatchVerifier(_merkleBatchVerifier);
        assetRegistry = AssetRegistry(_assetRegistry);
    }

    function setBridge(address _bridge) external onlyOwner {
        bridge = _bridge;
        emit BridgeSet(_bridge);
    }

    /**
     * @notice Set the protocol domain ID. Can only be called once.
     * @param _domainId Protocol domain ID (e.g. 0x02000002 for Base Sepolia)
     */
    function setDomainId(uint32 _domainId) external onlyOwner {
        require(!domainIdSet, "Domain ID already set");
        domainId = _domainId;
        domainIdSet = true;
    }

    /// @notice Bridge withdraw — burns a note, holds funds in the vault as outbound liability.
    function bridgeWithdraw(
        bytes calldata proof,
        bytes32 nullifierHash,
        address asset,
        uint256 amount,
        bytes32 extDataHash
    ) external onlyBridge nonReentrant {
        if (bridge == address(0)) revert BridgeNotSet();
        if (spentNullifiers[uint256(nullifierHash)]) revert NullifierUsed();
        if (!assetRegistry.isSupported(asset)) revert("Asset not supported");

        // Mark nullifier as spent
        spentNullifiers[uint256(nullifierHash)] = true;

        // Verify withdraw proof
        uint256[8] memory p = _parseProof(proof);

        // Public inputs: [root, nullifierHash, assetId, recipient, amount, relayer, relayerFee, publicDataHash]
        uint256[8] memory pubSignals = [
            getLastRoot(),
            uint256(nullifierHash),
            uint256(assetRegistry.getAssetId(asset)),
            uint256(uint160(bridge)),       // recipient = bridge contract
            amount,
            uint256(0),                      // relayer
            uint256(0),                      // relayerFee
            uint256(extDataHash)             // publicDataHash
        ];

        require(
            withdrawVerifier.verifyProof(
                [p[0], p[1]],
                [[p[2], p[3]], [p[4], p[5]]],
                [p[6], p[7]],
                pubSignals
            ),
            "Invalid withdraw proof"
        );

        bridgeOutgoing[asset] += amount;
        // NO transfer out — funds remain in vault as outbound liability

        emit BridgeWithdraw(nullifierHash, asset, amount, extDataHash);
    }

    /// @notice Bridge mint — inserts a new commitment from an inbound bridge message.
    function bridgeMint(
        address asset,
        uint256 amount,
        bytes32 newCommitment
    ) external onlyBridge nonReentrant {
        if (bridge == address(0)) revert BridgeNotSet();
        if (!assetRegistry.isSupported(asset)) revert("Asset not supported");
        bridgeIncoming[asset] += amount;
        insert(uint256(newCommitment));
        emit BridgeMint(asset, amount, newCommitment);
    }

    /**
     * @notice Deposit tokens into the pool with ZK proof
     * @param proof Groth16 proof data (256 bytes)
     * @param commitment Commitment hash (keccak256 of secret, nullifier, amount, asset)
     * @param amount Amount to deposit
     * @param token Token address (use address(0) for ETH)
     */
    function deposit(
        bytes calldata proof,
        uint256 commitment,
        uint256 amount,
        address token
    ) external payable nonReentrant {
        require(proof.length == 256, "Invalid proof length");
        require(assetRegistry.isSupported(token), "Asset not supported");
        require(commitment != 0, "Invalid commitment");
        
        // Verify deposit proof
        uint256[8] memory p = _parseProof(proof);
        uint256 assetId = uint256(assetRegistry.assetIds(token));
        uint256[3] memory pubSignals = [commitment, amount, assetId];

        require(
            depositVerifier.verifyProof(
                [p[0], p[1]],
                [[p[2], p[3]], [p[4], p[5]]],
                [p[6], p[7]],
                pubSignals
            ),
            "Invalid deposit proof"
        );

        // Transfer tokens to contract
        if (token == address(0)) {
            require(msg.value == amount, "ETH amount mismatch");
        } else {
            require(msg.value == 0, "ETH not accepted for ERC20");
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }

        // Enforce per-asset deposit limits
        (, , , uint256 minDeposit, uint256 maxDeposit) = assetRegistry.assets(token);
        require(amount >= minDeposit, "Below minimum deposit");
        require(amount <= maxDeposit, "Above maximum deposit");

        // Add commitment to pending buffer
        pendingDeposits.push(commitment);
        commitmentToPendingIndex[commitment] = pendingDeposits.length;

        emit Deposit(commitment, amount, token, pendingDeposits.length - 1);
    }

    /**
     * @notice Withdraw tokens from the pool with ZK proof
     * @param proof Groth16 proof data (256 bytes)
     * @param nullifierHash Nullifier hash (prevents double spend)
     * @param root Merkle root at time of withdrawal
     * @param recipient Recipient address
     * @param token Token address (use address(0) for ETH)
     * @param amount Amount to withdraw
     * @param fee Relayer fee
     * @param relayer Relayer address (address(0) if no relayer)
     */
    function withdraw(
        bytes calldata proof,
        uint256 nullifierHash,
        uint256 root,
        address recipient,
        address token,
        uint256 amount,
        uint256 fee,
        address relayer
    ) external nonReentrant {
        _withdrawInternal(proof, nullifierHash, root, recipient, token, amount, fee, relayer, new bytes(0));
    }

    function withdrawStealth(
        bytes calldata proof,
        uint256 nullifierHash,
        uint256 root,
        address recipient,
        address token,
        uint256 amount,
        uint256 fee,
        address relayer,
        bytes calldata ephemeralPubkey
    ) external nonReentrant {
        require(ephemeralPubkey.length == 33, "Invalid ephemeral pubkey length");
        require(ephemeralPubkey[0] == 0x02 || ephemeralPubkey[0] == 0x03, "Invalid ephemeral pubkey prefix");
        _withdrawInternal(proof, nullifierHash, root, recipient, token, amount, fee, relayer, ephemeralPubkey);
    }

    function _withdrawInternal(
        bytes calldata proof,
        uint256 nullifierHash,
        uint256 root,
        address recipient,
        address token,
        uint256 amount,
        uint256 fee,
        address relayer,
        bytes memory ephemeralPubkey
    ) internal {
        require(proof.length == 256, "Invalid proof length");
        require(!spentNullifiers[nullifierHash], "Nullifier already spent");
        require(isKnownRoot(root), "Unknown Merkle root");
        require(recipient != address(0), "Invalid recipient");
        require(fee <= amount * MAX_FEE_BPS / 10000, "Fee too high");
        require(assetRegistry.isSupported(token), "Asset not supported");
        require(relayer == address(0) || isRelayer[relayer], "Invalid relayer");

        // Mark nullifier as spent
        spentNullifiers[nullifierHash] = true;

        // Verify withdraw proof
        uint256[8] memory p = _parseProof(proof);

        // Public inputs: [root, nullifierHash, assetId, recipient, amount, relayer, relayerFee, publicDataHash]
        uint256[8] memory pubSignals = [
            root,
            nullifierHash,
            uint256(assetRegistry.getAssetId(token)),
            uint256(uint160(recipient)),
            amount,
            uint256(uint160(relayer)),
            fee,
            0 // publicDataHash
        ];

        require(
            withdrawVerifier.verifyProof(
                [p[0], p[1]],
                [[p[2], p[3]], [p[4], p[5]]],
                [p[6], p[7]],
                pubSignals
            ),
            "Invalid withdraw proof"
        );

        // Calculate amounts
        uint256 recipientAmount = amount - fee;

        // Transfer to recipient
        if (token == address(0)) {
            (bool success, ) = payable(recipient).call{value: recipientAmount}("");
            require(success, "ETH transfer failed");

            if (fee > 0 && relayer != address(0)) {
                (bool feeSuccess, ) = payable(relayer).call{value: fee}("");
                require(feeSuccess, "Fee transfer failed");
            }
        } else {
            IERC20(token).safeTransfer(recipient, recipientAmount);

            if (fee > 0 && relayer != address(0)) {
                IERC20(token).safeTransfer(relayer, fee);
            }
        }

        emit Withdrawal(nullifierHash, recipient, relayer, amount, fee);

        if (ephemeralPubkey.length > 0) {
            emit StealthWithdrawal(ephemeralPubkey, recipient, block.number);
        }
    }

    /**
     * @notice Settle a batch of pending deposits into the Merkle tree
     * @param proof Groth16 proof for batch update
     * @param oldRoot Previous Merkle root
     * @param newRoot New Merkle root after insertion
     * @param startIndex Starting leaf index
     * @param batchSize Number of commitments to insert
     * @param commitmentsHash Hash of all commitments in batch
     */
    function settleBatch(
        bytes calldata proof,
        uint256 oldRoot,
        uint256 newRoot,
        uint256 startIndex,
        uint256 batchSize,
        uint256 commitmentsHash
    ) external nonReentrant {
        require(proof.length == 256, "Invalid proof length");
        require(oldRoot == getLastRoot(), "Old root mismatch");
        require(startIndex == nextLeafIndex, "Start index mismatch");
        require(batchSize > 0 && batchSize <= pendingDeposits.length, "Invalid batch size");

        // Verify batch proof
        uint256[8] memory p = _parseProof(proof);
        uint256[5] memory pubSignals = [oldRoot, newRoot, startIndex, batchSize, commitmentsHash];
        
        require(
            merkleBatchVerifier.verifyProof(
                [p[0], p[1]],
                [[p[2], p[3]], [p[4], p[5]]],
                [p[6], p[7]],
                pubSignals
            ),
            "Invalid batch proof"
        );

        // Insert commitments into tree
        for (uint256 i = 0; i < batchSize; i++) {
            uint256 commitment = pendingDeposits[i];
            insert(commitment);
            delete commitmentToPendingIndex[commitment];
        }

        // Shift remaining pending deposits
        for (uint256 i = batchSize; i < pendingDeposits.length; i++) {
            pendingDeposits[i - batchSize] = pendingDeposits[i];
            commitmentToPendingIndex[pendingDeposits[i]] = i - batchSize;
        }
        
        // Resize array
        for (uint256 i = 0; i < batchSize; i++) {
            pendingDeposits.pop();
        }

        require(getLastRoot() == newRoot, "New root mismatch");

        emit BatchSettlement(startIndex, batchSize, newRoot);
    }

    /**
     * @notice Register a relayer
     */
    function registerRelayer(address relayer) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        require(!isRelayer[relayer], "Already registered");
        isRelayer[relayer] = true;
        emit RelayerRegistered(relayer);
    }

    /**
     * @notice Remove a relayer
     */
    function removeRelayer(address relayer) external onlyOwner {
        require(isRelayer[relayer], "Not a relayer");
        isRelayer[relayer] = false;
        emit RelayerRemoved(relayer);
    }

    /**
     * @notice Add a supported asset
     * @param token Asset address (use address(0) for ETH)
     * @param isYield Whether the asset is yield-bearing
     * @param decimals Asset decimals
     * @param minDeposit Minimum deposit amount
     * @param maxDeposit Maximum deposit amount
     */
    function addSupportedAsset(
        address token,
        bool isYield,
        uint8 decimals,
        uint256 minDeposit,
        uint256 maxDeposit
    ) external onlyOwner {
        assetRegistry.addAsset(token, isYield, decimals, minDeposit, maxDeposit);
    }

    /**
     * @notice Remove a supported asset
     * @param token Asset address to remove
     */
    function removeSupportedAsset(address token) external onlyOwner {
        assetRegistry.removeAsset(token);
    }

    /**
     * @notice Check if an asset is supported
     * @param token Asset address to check
     * @return bool True if supported
     */
    function isSupported(address token) external view returns (bool) {
        return assetRegistry.isSupported(token);
    }

    /**
     * @notice Get pending deposits count
     */
    function getPendingDepositsCount() external view returns (uint256) {
        return pendingDeposits.length;
    }

    /**
     * @notice Get pending deposit at index
     */
    function getPendingDeposit(uint256 index) external view returns (uint256) {
        require(index < pendingDeposits.length, "Index out of bounds");
        return pendingDeposits[index];
    }

    /**
     * @notice Check if nullifier has been spent
     */
    function isSpent(uint256 nullifierHash) external view returns (bool) {
        return spentNullifiers[nullifierHash];
    }

    /**
     * @notice Parse 256-byte proof into 8 field elements
     */
    function _parseProof(bytes calldata proof) internal pure returns (uint256[8] memory) {
        require(proof.length == 256, "Invalid proof length");
        
        uint256[8] memory p;
        for (uint256 i = 0; i < 8; i++) {
            p[i] = uint256(bytes32(proof[i * 32:(i + 1) * 32]));
        }
        return p;
    }

    /**
     * @notice Receive ETH
     */
    receive() external payable {}
}
