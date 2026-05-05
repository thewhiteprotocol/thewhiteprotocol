// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/WhiteProtocol.sol";
import "../contracts/AssetRegistry.sol";

/**
 * @title UpgradeEthereumWP
 * @notice Minimal Ethereum Sepolia WhiteProtocol upgrade for PR-010K.
 * @dev Deploys a new WhiteProtocol reusing existing verifiers and AssetRegistry,
 *      wires it to the existing BridgeOutbox, and updates the deployment artifact.
 *
 * Environment:
 *   DEPLOYER_PRIVATE_KEY — deployer key
 *   ETH_RPC_URL          — Ethereum Sepolia RPC
 */
contract UpgradeEthereumWP is Script {
    uint256 constant EXPECTED_EMPTY_ROOT =
        15019797232609675441998260052101280400536945603062888308240081994073687793470;

    // Existing Ethereum Sepolia contracts (PR-010G deployment)
    address constant EXISTING_DEPOSIT_VERIFIER = 0x0eb44c154DF83876fB44042e822e3373Fbf57d95;
    address constant EXISTING_WITHDRAW_VERIFIER = 0x66c1741f1f85f7Bb04286B7a26E870a8D3e52Eee;
    address constant EXISTING_MERKLE_BATCH_VERIFIER = 0x0Bb7ED4A34558A44FDc8bCC7c9560948a082bc9E;
    address constant EXISTING_ASSET_REGISTRY = 0xE8efDE51cA7B4b0dAD84e5a7296Baac87A09029B;
    address constant EXISTING_BRIDGE_OUTBOX = 0x8831AB44113a5De63f1577E157F3E7faaBeeC314;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        console.log("============================================================");
        console.log("PR-010K: Ethereum Sepolia WhiteProtocol Upgrade");
        console.log("Deployer:", deployer);
        console.log("============================================================");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy new WhiteProtocol with existing verifiers + AssetRegistry
        WhiteProtocol newWP = new WhiteProtocol(
            deployer,
            EXISTING_DEPOSIT_VERIFIER,
            EXISTING_WITHDRAW_VERIFIER,
            EXISTING_MERKLE_BATCH_VERIFIER,
            EXISTING_ASSET_REGISTRY
        );
        address newWPAddr = payable(address(newWP));
        console.log("New WhiteProtocol deployed:", newWPAddr);

        // Set domain ID (can only be called once)
        newWP.setDomainId(33554435);
        console.log("Domain ID set:", uint256(33554435));

        // Register deployer as relayer
        newWP.registerRelayer(deployer);
        console.log("Deployer registered as relayer");

        // Wire to existing BridgeOutbox
        newWP.setBridgeOutbox(EXISTING_BRIDGE_OUTBOX);
        console.log("BridgeOutbox set:", EXISTING_BRIDGE_OUTBOX);

        vm.stopBroadcast();

        // Post-deploy verification
        require(newWP.getLastRoot() == EXPECTED_EMPTY_ROOT, "Empty root mismatch");
        require(newWP.nextLeafIndex() == 0, "nextLeafIndex must be 0");
        require(newWP.domainId() == 33554435, "Domain ID mismatch");
        require(newWP.isRelayer(deployer), "Deployer not relayer");
        require(newWP.bridgeOutbox() == EXISTING_BRIDGE_OUTBOX, "BridgeOutbox mismatch");
        console.log("All verifications passed");

        // Update deployment artifact
        _updateArtifact(newWPAddr, deployer);

        // Print setWhiteProtocol command for BridgeOutbox
        console.log("============================================================");
        console.log("Next step: wire BridgeOutbox to new WhiteProtocol");
        console.log("cast send", EXISTING_BRIDGE_OUTBOX, '"setWhiteProtocol(address)"', newWPAddr);
        console.log("============================================================");
    }

    function _updateArtifact(address newWP, address deployer) internal {
        string memory path = "deployments/ethereum-sepolia.json";
        string memory json = vm.readFile(path);

        // Backup previous artifact
        string memory backupPath = "deployments/ethereum-sepolia-pr010g-backup.json";
        vm.writeFile(backupPath, json);
        console.log("Previous artifact backed up to:", backupPath);

        // Update WhiteProtocol address
        json = _replaceOnce(json, '"WhiteProtocol": "0x5813d68a130C451420C670F5aA4a7D68F438101A"', string.concat('"WhiteProtocol": "', vm.toString(newWP), '"'));

        // Add generation note
        json = _replaceOnce(json, '"network": "ethereum-sepolia"', '"network": "ethereum-sepolia",\n    "generation": "PR-010K"');

        // Update deployedAt
        string memory deployedAt = vm.toString(block.timestamp);
        json = _replaceOnce(json, '"deployedAt": "2026-05-03T19:48:48Z"', string.concat('"deployedAt": "', deployedAt, '"'));

        vm.writeFile(path, json);
        console.log("Artifact updated:", path);
    }

    function _replaceOnce(string memory str, string memory from, string memory to)
        internal
        pure
        returns (string memory)
    {
        bytes memory strBytes = bytes(str);
        bytes memory fromBytes = bytes(from);
        bytes memory toBytes = bytes(to);

        uint256 i = 0;
        while (i <= strBytes.length - fromBytes.length) {
            bool match_ = true;
            for (uint256 j = 0; j < fromBytes.length; j++) {
                if (strBytes[i + j] != fromBytes[j]) {
                    match_ = false;
                    break;
                }
            }
            if (match_) {
                bytes memory result = new bytes(
                    strBytes.length - fromBytes.length + toBytes.length
                );
                for (uint256 k = 0; k < i; k++) result[k] = strBytes[k];
                for (uint256 k = 0; k < toBytes.length; k++) {
                    result[i + k] = toBytes[k];
                }
                for (uint256 k = i + fromBytes.length; k < strBytes.length; k++) {
                    result[k - fromBytes.length + toBytes.length] = strBytes[k];
                }
                return string(result);
            }
            i++;
        }
        return str;
    }


}
