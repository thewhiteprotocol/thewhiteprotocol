// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/WhiteProtocol.sol";
import "../contracts/AssetRegistry.sol";
import "../contracts/IVerifiers.sol";

/**
 * @title DeployWithAssets
 * @notice Deployment script that adds ETH as supported asset
 */
contract DeployWithAssets is Script {
    // Mock verifier contracts for testing
    MockDepositVerifier public depositVerifier;
    MockWithdrawVerifier public withdrawVerifier;
    MockMerkleBatchVerifier public merkleBatchVerifier;
    
    // Core contracts
    AssetRegistry public assetRegistry;
    WhiteProtocol public whiteProtocol;
    
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        
        console.log("Deploying from:", deployer);
        
        vm.startBroadcast(deployerPrivateKey);
        
        // 1. Deploy mock verifiers
        console.log("Deploying mock verifiers...");
        depositVerifier = new MockDepositVerifier();
        withdrawVerifier = new MockWithdrawVerifier();
        merkleBatchVerifier = new MockMerkleBatchVerifier();
        
        // 2. Deploy AssetRegistry
        console.log("Deploying AssetRegistry...");
        assetRegistry = new AssetRegistry(deployer);
        
        // 3. Add ETH as supported asset BEFORE transferring ownership
        console.log("Adding ETH as supported asset...");
        assetRegistry.addAsset(
            address(0),           // ETH address
            false,                // not yield-bearing
            18,                   // decimals
            0.001 ether,          // min deposit
            1000 ether            // max deposit
        );
        console.log("ETH added as supported asset");
        
        // 4. Deploy WhiteProtocol
        console.log("Deploying WhiteProtocol...");
        whiteProtocol = new WhiteProtocol(
            deployer,
            address(depositVerifier),
            address(withdrawVerifier),
            address(merkleBatchVerifier),
            address(assetRegistry)
        );
        
        // 5. Transfer AssetRegistry ownership to WhiteProtocol
        console.log("Transferring AssetRegistry ownership...");
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

// Mock verifier contracts
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
