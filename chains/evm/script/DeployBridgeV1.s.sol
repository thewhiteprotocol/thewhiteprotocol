// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/BridgeInbox.sol";
import "../contracts/BridgeOutbox.sol";
import "../contracts/WhiteProtocol.sol";
import "../contracts/AssetRegistry.sol";

/**
 * @title DeployBridgeV1
 * @notice Deploys and configures BridgeInbox + BridgeOutbox for a given network.
 * @dev Reads existing core deployment artifact, deploys bridge contracts,
 *      configures routes/assets/caps/signer sets, and authorizes BridgeInbox
 *      in WhiteProtocol. Updates deployment artifact with bridgeV1 section.
 *
 * Environment:
 *   NETWORK              — target network key (e.g. "base-sepolia")
 *   DEPLOYER_PRIVATE_KEY — deployer key
 *   BRIDGE_SIGNER_1_ADDRESS .. BRIDGE_SIGNER_3_ADDRESS — test signer addresses
 *   BRIDGE_SIGNER_THRESHOLD — default 2
 */
contract DeployBridgeV1 is Script {
    // -------------------------------------------------------------------------
    // Defaults (testnet-only signers generated for PR-010G)
    // These addresses are public; private keys live in .bridge-signers.env
    // -------------------------------------------------------------------------
    address constant DEFAULT_SIGNER_1 = 0x9A34F10F5b9AD7770C30A3B41d95C4Dcb0B88820;
    address constant DEFAULT_SIGNER_2 = 0xbd7d34e42352BCe888394263A84CF21c85608beC;
    address constant DEFAULT_SIGNER_3 = 0xEa4A68F39630C5145f1840D754B470a9fa5F2c19;
    uint256 constant DEFAULT_THRESHOLD = 2;

    // Cap configuration (testnet — generous but bounded)
    uint128 constant MAX_MESSAGE_AMOUNT = 10 ether;
    uint128 constant DAILY_OUTFLOW_CAP = 1000 ether;
    uint128 constant DAILY_INFLOW_CAP = 1000 ether;
    uint128 constant GLOBAL_DAILY_CAP = 5000 ether;

    struct Deployment {
        address whiteProtocol;
        address assetRegistry;
        uint32 domainId;
        string network;
        uint256 chainId;
    }

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        string memory network = vm.envString("NETWORK");

        console.log("============================================================");
        console.log("The White Protocol - Bridge V1 Deployment");
        console.log("Network:", network);
        console.log("Deployer:", deployer);
        console.log("============================================================");

        Deployment memory dep = _loadDeployment(network);
        _guardChainId(dep.chainId);

        address[] memory signers = _loadSignerAddresses();
        uint256 threshold = vm.envOr("BRIDGE_SIGNER_THRESHOLD", DEFAULT_THRESHOLD);

        console.log("Signer set (threshold =", threshold, "):");
        for (uint256 i = 0; i < signers.length; i++) {
            console.log("  ", i + 1, ":", signers[i]);
        }

        // Load network config for peer domain IDs
        string memory networksJson = vm.readFile("configs/networks.json");

        // Deploy and configure
        (address outbox, address inbox) = _deployAndConfigure(
            deployerPrivateKey,
            deployer,
            dep,
            signers,
            threshold,
            networksJson
        );

        // Update deployment artifact
        _updateArtifact(network, dep, outbox, inbox, signers, threshold);

        console.log("============================================================");
        console.log("Bridge V1 Deployment Complete");
        console.log("============================================================");
    }

    function _loadDeployment(string memory network)
        internal
        view
        returns (Deployment memory dep)
    {
        string memory path = string.concat("deployments/", network, ".json");
        string memory json = vm.readFile(path);

        dep.whiteProtocol = vm.parseAddress(
            vm.parseJsonString(json, ".contracts.WhiteProtocol")
        );
        dep.assetRegistry = vm.parseAddress(
            vm.parseJsonString(json, ".contracts.AssetRegistry")
        );
        dep.domainId = uint32(vm.parseJsonUint(json, ".domainId"));
        dep.network = network;
        dep.chainId = uint256(vm.parseJsonUint(json, ".chainId"));

        console.log("Loaded core deployment:");
        console.log("  WhiteProtocol:", dep.whiteProtocol);
        console.log("  AssetRegistry:", dep.assetRegistry);
        console.log("  Domain ID:", dep.domainId);
    }

    function _guardChainId(uint256 expected) internal view {
        require(
            block.chainid == expected,
            string.concat(
                "Chain ID mismatch: expected ",
                vm.toString(expected),
                ", got ",
                vm.toString(block.chainid)
            )
        );
    }

    function _loadSignerAddresses() internal view returns (address[] memory signers) {
        signers = new address[](3);
        signers[0] = vm.envOr("BRIDGE_SIGNER_1_ADDRESS", DEFAULT_SIGNER_1);
        signers[1] = vm.envOr("BRIDGE_SIGNER_2_ADDRESS", DEFAULT_SIGNER_2);
        signers[2] = vm.envOr("BRIDGE_SIGNER_3_ADDRESS", DEFAULT_SIGNER_3);

        // Validate sorted ascending (contract requirement for signature verification)
        for (uint256 i = 1; i < signers.length; i++) {
            require(signers[i] > signers[i - 1], "Signer addresses must be sorted ascending");
        }
    }

    function _deployAndConfigure(
        uint256 deployerPrivateKey,
        address deployer,
        Deployment memory dep,
        address[] memory signers,
        uint256 threshold,
        string memory networksJson
    ) internal returns (address outbox, address inbox) {
        // Compute canonical asset ID for native ETH on this domain (v2)
        bytes32 canonicalAssetId = _computeV2AssetId(dep.domainId, address(0));
        console.log("Canonical asset ID (native ETH):");
        console.logBytes32(canonicalAssetId);

        // Determine peer domain(s) from networks.json
        // For simplicity we enable routes to/from all other testnet domains
        uint32[] memory peerDomains = _loadPeerDomains(dep.network, networksJson);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy BridgeOutbox
        console.log("Deploying BridgeOutbox...");
        BridgeOutbox bridgeOutbox = new BridgeOutbox(deployer, dep.domainId);
        outbox = address(bridgeOutbox);
        console.log("BridgeOutbox:", outbox);

        // Deploy BridgeInbox
        console.log("Deploying BridgeInbox...");
        BridgeInbox bridgeInbox = new BridgeInbox(deployer, dep.domainId);
        inbox = address(bridgeInbox);
        console.log("BridgeInbox:", inbox);

        // Configure BridgeOutbox
        console.log("Configuring BridgeOutbox...");
        for (uint256 i = 0; i < peerDomains.length; i++) {
            bridgeOutbox.enableRoute(peerDomains[i]);
            console.log("  Enabled outbox route to domain:", peerDomains[i]);
        }
        bridgeOutbox.supportAsset(canonicalAssetId);
        bridgeOutbox.setMaxMessageAmount(canonicalAssetId, MAX_MESSAGE_AMOUNT);
        bridgeOutbox.setOutflowCap(canonicalAssetId, DAILY_OUTFLOW_CAP);
        bridgeOutbox.setDailyOutflowCap(canonicalAssetId, DAILY_OUTFLOW_CAP);

        // Configure BridgeInbox
        console.log("Configuring BridgeInbox...");
        bridgeInbox.setWhiteProtocol(dep.whiteProtocol);
        for (uint256 i = 0; i < peerDomains.length; i++) {
            bridgeInbox.enableRoute(peerDomains[i]);
            console.log("  Enabled inbox route from domain:", peerDomains[i]);
        }
        bridgeInbox.supportAsset(canonicalAssetId);
        bridgeInbox.setLocalAsset(canonicalAssetId, address(0)); // native ETH
        bridgeInbox.setMaxMessageAmount(canonicalAssetId, MAX_MESSAGE_AMOUNT);
        bridgeInbox.setInflowCap(canonicalAssetId, DAILY_INFLOW_CAP);
        bridgeInbox.setDailyInflowCap(canonicalAssetId, DAILY_INFLOW_CAP);
        bridgeInbox.setGlobalDailyCap(GLOBAL_DAILY_CAP);
        bridgeInbox.updateSignerSet(signers, threshold);

        // Authorize BridgeInbox in WhiteProtocol
        console.log("Authorizing BridgeInbox in WhiteProtocol...");
        WhiteProtocol whiteProtocol = WhiteProtocol(payable(dep.whiteProtocol));
        whiteProtocol.setBridge(inbox);

        vm.stopBroadcast();

        // Verify
        console.log("Post-deploy verification...");
        require(bridgeInbox.localDomain() == dep.domainId, "Inbox domain mismatch");
        require(bridgeOutbox.localDomain() == dep.domainId, "Outbox domain mismatch");
        require(bridgeInbox.currentSignerSetVersion() == 1, "Signer set version mismatch");
        require(whiteProtocol.bridge() == inbox, "WhiteProtocol bridge not set");
        console.log("All verifications passed");
    }

    function _loadPeerDomains(
        string memory network,
        string memory networksJson
    ) internal view returns (uint32[] memory peers) {
        // Parse all networks and collect testnet peers
        string[] memory keys = vm.parseJsonKeys(networksJson, ".");
        uint256 peerCount = 0;
        for (uint256 i = 0; i < keys.length; i++) {
            if (keccak256(bytes(keys[i])) == keccak256(bytes(network))) continue;
            bool isTestnet = vm.parseJsonBool(
                networksJson,
                string.concat(".", keys[i], ".isTestnet")
            );
            if (isTestnet) peerCount++;
        }

        peers = new uint32[](peerCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < keys.length; i++) {
            if (keccak256(bytes(keys[i])) == keccak256(bytes(network))) continue;
            bool isTestnet = vm.parseJsonBool(
                networksJson,
                string.concat(".", keys[i], ".isTestnet")
            );
            if (isTestnet) {
                peers[idx] = uint32(
                    vm.parseJsonUint(networksJson, string.concat(".", keys[i], ".domainId"))
                );
                idx++;
            }
        }
    }

    function _computeV2AssetId(uint32 domainId, address token)
        internal
        pure
        returns (bytes32)
    {
        // Formula: 0x00 || keccak256("white:asset_id:v2" || uint32BE(domainId) || token)[0..31]
        bytes memory prefix = bytes("white:asset_id:v2");
        bytes memory domainBytes = new bytes(4);
        domainBytes[0] = bytes1(uint8(domainId >> 24));
        domainBytes[1] = bytes1(uint8(domainId >> 16));
        domainBytes[2] = bytes1(uint8(domainId >> 8));
        domainBytes[3] = bytes1(uint8(domainId));

        bytes memory data = abi.encodePacked(prefix, domainBytes, token);
        bytes32 hash = keccak256(data);

        // Mask to 31 bytes and prepend 0x00
        return bytes32(uint256(hash) & 0x00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    }

    function _updateArtifact(
        string memory network,
        Deployment memory dep,
        address outbox,
        address inbox,
        address[] memory signers,
        uint256 threshold
    ) internal {
        string memory bridgePath = string.concat("deployments/", network, "-bridge-v1.json");

        string memory obj = "bridge";
        vm.serializeString(obj, "network", network);
        vm.serializeUint(obj, "chainId", dep.chainId);
        vm.serializeUint(obj, "domainId", uint256(dep.domainId));
        vm.serializeString(obj, "domainIdHex", _toHex(dep.domainId));
        vm.serializeAddress(obj, "BridgeOutbox", outbox);
        vm.serializeAddress(obj, "BridgeInbox", inbox);
        vm.serializeUint(obj, "signerSetVersion", 1);
        vm.serializeUint(obj, "threshold", threshold);
        vm.serializeAddress(obj, "signers", signers);
        string memory finalJson = vm.serializeString(obj, "deployedAt", _toISOString(block.timestamp));

        vm.writeJson(finalJson, bridgePath);
        console.log("Bridge artifact saved to:", bridgePath);
    }

    function _toHex(uint32 value) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory buf = new bytes(8);
        for (uint256 i = 0; i < 8; i++) {
            buf[7 - i] = hexChars[value & 0xf];
            value >>= 4;
        }
        return string.concat("0x", string(buf));
    }

    function _toISOString(uint256 timestamp) internal pure returns (string memory) {
        // Simple Unix timestamp string (avoids FFI dependency)
        return vm.toString(timestamp);
    }
}
