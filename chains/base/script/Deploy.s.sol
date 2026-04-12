// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/WhiteProtocol.sol";
import "../contracts/AssetRegistry.sol";
import "../contracts/MerkleTreeWithHistory.sol";
import "../contracts/PoseidonHasher.sol";

/**
 * @title Deploy
 * @notice Deployment script for White Protocol on Base Sepolia
 * @dev Deploys: MockVerifiers, AssetRegistry, WhiteProtocol
 */
contract Deploy is Script {
    // Mock verifier contracts for testing
    MockDepositVerifier public depositVerifier;
    MockWithdrawVerifier public withdrawVerifier;
    MockMerkleBatchVerifier public merkleBatchVerifier;
    
    // Core contracts
    AssetRegistry public assetRegistry;
    WhiteProtocol public whiteProtocol;
    PoseidonHasher public poseidonHasher;
    MerkleTreeWithHistory public merkleTree;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying from:", deployer);
        console.log("Chain ID:", block.chainid);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy mock verifiers (replace with real ones for production)
        console.log("Deploying mock verifiers...");
        depositVerifier = new MockDepositVerifier();
        withdrawVerifier = new MockWithdrawVerifier();
        merkleBatchVerifier = new MockMerkleBatchVerifier();
        console.log("MockDepositVerifier:", address(depositVerifier));
        console.log("MockWithdrawVerifier:", address(withdrawVerifier));
        console.log("MockMerkleBatchVerifier:", address(merkleBatchVerifier));
        
        // 2. Deploy AssetRegistry
        console.log("Deploying AssetRegistry...");
        assetRegistry = new AssetRegistry(deployer);
        console.log("AssetRegistry:", address(assetRegistry));
        
        // 3. Deploy WhiteProtocol
        console.log("Deploying WhiteProtocol...");
        whiteProtocol = new WhiteProtocol(
            deployer,
            address(depositVerifier),
            address(withdrawVerifier),
            address(merkleBatchVerifier),
            address(assetRegistry)
        );
        console.log("WhiteProtocol:", address(whiteProtocol));
        
        // 4. Transfer AssetRegistry ownership to WhiteProtocol
        console.log("Transferring AssetRegistry ownership to WhiteProtocol...");
        assetRegistry.transferOwnership(address(whiteProtocol));
        
        vm.stopBroadcast();
        
        console.log("\n=== Deployment Complete ===");
        console.log("Chain ID:", block.chainid);
        console.log("DepositVerifier:", address(depositVerifier));
        console.log("WithdrawVerifier:", address(withdrawVerifier));
        console.log("MerkleBatchVerifier:", address(merkleBatchVerifier));
        console.log("AssetRegistry:", address(assetRegistry));
        console.log("WhiteProtocol:", address(whiteProtocol));
        
    }
}

// Mock verifier contracts for testing
contract MockDepositVerifier is IDepositVerifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[1] calldata
    ) external pure returns (bool) {
        return true;
    }
}

contract MockWithdrawVerifier is IWithdrawVerifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[8] calldata
    ) external pure returns (bool) {
        return true;
    }
}

contract MockMerkleBatchVerifier is IMerkleBatchVerifier {
    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[5] calldata
    ) external pure returns (bool) {
        return true;
    }
}
