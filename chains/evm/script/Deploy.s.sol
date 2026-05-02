// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/IVerifiers.sol";
import "../contracts/AssetRegistry.sol";
import "../contracts/WhiteProtocol.sol";
import "../contracts/test/WrappedNative9.sol";

/**
 * @title Deploy
 * @notice Network-driven deployment script for White Protocol on any EVM chain
 * @dev Reads network config from configs/networks.json
 */
contract Deploy is Script {
    uint256 constant EXPECTED_EMPTY_ROOT =
        15019797232609675441998260052101280400536945603062888308240081994073687793470;

    // Deployment state (storage to avoid stack too deep)
    address public s_depositVerifier;
    address public s_withdrawVerifier;
    address public s_merkleBatchVerifier;
    address public s_assetRegistry;
    address public s_whiteProtocol;
    address public s_wrappedNative;
    bool public s_wrappedNativeDeployed;
    address public s_usdc;
    bool public s_usdcPresent;
    address public s_usdt;
    bool public s_usdtPresent;
    uint32 public s_domainId;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        string memory network = vm.envString("NETWORK");

        console.log("============================================================");
        console.log("The White Protocol - Network Deployment");
        console.log("Network:", network);
        console.log("Deployer:", deployer);
        console.log("============================================================");

        _loadAndGuard(network);
        _deployCore(deployerPrivateKey, deployer, network);
        _resolveWrappedNative(network, deployerPrivateKey);
        _resolveUsdc(network);
        _resolveUsdt(network);
        _configurePool(deployerPrivateKey, deployer);
        _verifyAndSave(network, deployer);
    }

    function _loadAndGuard(string memory network) internal view {
        string memory networksJson = vm.readFile("configs/networks.json");

        uint256 expectedChainId = vm.parseJsonUint(
            networksJson, string.concat(".", network, ".chainId")
        );
        bool isTestnet = vm.parseJsonBool(
            networksJson, string.concat(".", network, ".isTestnet")
        );
        bool isLive = vm.parseJsonBool(
            networksJson, string.concat(".", network, ".isLive")
        );

        if (!isLive && !isTestnet) {
            bool allowMainnet = vm.envOr("ALLOW_MAINNET", false);
            require(
                allowMainnet,
                "Mainnet deployment blocked: set ALLOW_MAINNET=true"
            );
            console.log("ALLOW_MAINNET override active - proceeding with mainnet deploy");
        }

        require(
            block.chainid == expectedChainId,
            string.concat(
                "Chain ID mismatch: expected ",
                vm.toString(expectedChainId),
                ", got ",
                vm.toString(block.chainid)
            )
        );
    }

    function _deployCore(uint256 deployerPrivateKey, address deployer, string memory network) internal {
        string memory networksJson = vm.readFile("configs/networks.json");
        uint32 domainId = uint32(vm.parseJsonUint(networksJson, string.concat(".", network, ".domainId")));
        s_domainId = domainId;

        vm.startBroadcast(deployerPrivateKey);

        console.log("Deploying DepositVerifier...");
        s_depositVerifier = _deployBytecode("DepositVerifier.sol:Groth16Verifier");
        console.log("DepositVerifier:", s_depositVerifier);

        console.log("Deploying WithdrawVerifier...");
        s_withdrawVerifier = _deployBytecode("WithdrawVerifier.sol:Groth16Verifier");
        console.log("WithdrawVerifier:", s_withdrawVerifier);

        console.log("Deploying MerkleBatchVerifier...");
        s_merkleBatchVerifier = _deployBytecode("MerkleBatchVerifier.sol:Groth16Verifier");
        console.log("MerkleBatchVerifier:", s_merkleBatchVerifier);

        console.log("Deploying AssetRegistry...");
        AssetRegistry assetRegistry = new AssetRegistry(deployer);
        s_assetRegistry = address(assetRegistry);
        console.log("AssetRegistry:", s_assetRegistry);

        console.log("Configuring AssetRegistry domain...");
        assetRegistry.configureDomain(domainId, 2);
        console.log("Domain ID:", domainId);

        console.log("Deploying WhiteProtocol...");
        WhiteProtocol whiteProtocol = new WhiteProtocol(
            deployer,
            s_depositVerifier,
            s_withdrawVerifier,
            s_merkleBatchVerifier,
            s_assetRegistry
        );
        s_whiteProtocol = payable(address(whiteProtocol));
        console.log("WhiteProtocol:", s_whiteProtocol);

        console.log("Setting WhiteProtocol domain ID...");
        whiteProtocol.setDomainId(domainId);

        console.log("Transferring AssetRegistry ownership...");
        assetRegistry.transferOwnership(s_whiteProtocol);

        vm.stopBroadcast();
    }

    function _resolveWrappedNative(string memory network, uint256 deployerPrivateKey) internal {
        string memory networksJson = vm.readFile("configs/networks.json");
        string memory wrappedNativeRaw = vm.parseJsonString(
            networksJson, string.concat(".", network, ".wrappedNative")
        );
        bool wrappedNativeIsNull = keccak256(bytes(wrappedNativeRaw)) == keccak256(bytes("null"));
        bool deployWrappedNativeIfNull = false;
        try vm.parseJsonBool(
            networksJson, string.concat(".", network, ".deployWrappedNativeIfNull")
        ) returns (bool b) {
            deployWrappedNativeIfNull = b;
        } catch {}

        address wrappedNativeOverride = vm.envOr("WRAPPED_NATIVE_OVERRIDE", address(0));

        if (!wrappedNativeIsNull) {
            s_wrappedNative = vm.parseAddress(wrappedNativeRaw);
            if (wrappedNativeOverride != address(0)) {
                s_wrappedNative = wrappedNativeOverride;
            }
            require(s_wrappedNative.code.length > 0, "Wrapped native contract not found on-chain");
            console.log("Using existing wrapped native:", s_wrappedNative);
        } else if (deployWrappedNativeIfNull) {
            vm.startBroadcast(deployerPrivateKey);
            WrappedNative9 weth = new WrappedNative9();
            vm.stopBroadcast();
            s_wrappedNative = address(weth);
            s_wrappedNativeDeployed = true;
            console.log("Deployed WrappedNative9:", s_wrappedNative);
        } else {
            revert("wrappedNative is null but deployWrappedNativeIfNull is false");
        }
    }

    function _resolveUsdc(string memory network) internal {
        string memory networksJson = vm.readFile("configs/networks.json");
        string memory usdcRaw = vm.parseJsonString(
            networksJson, string.concat(".", network, ".usdc")
        );
        bool usdcIsNull = keccak256(bytes(usdcRaw)) == keccak256(bytes("null"));
        address usdcOverride = vm.envOr("USDC_OVERRIDE", address(0));

        if (!usdcIsNull) {
            s_usdc = vm.parseAddress(usdcRaw);
            if (usdcOverride != address(0)) {
                s_usdc = usdcOverride;
            }
            s_usdcPresent = true;
            console.log("Using USDC:", s_usdc);
        }
    }

    function _resolveUsdt(string memory network) internal {
        string memory networksJson = vm.readFile("configs/networks.json");
        string memory usdtRaw = vm.parseJsonString(
            networksJson, string.concat(".", network, ".usdt")
        );
        bool usdtIsNull = keccak256(bytes(usdtRaw)) == keccak256(bytes("null"));
        address usdtOverride = vm.envOr("USDT_OVERRIDE", address(0));

        if (!usdtIsNull) {
            s_usdt = vm.parseAddress(usdtRaw);
            if (usdtOverride != address(0)) {
                s_usdt = usdtOverride;
            }
            s_usdtPresent = true;
            console.log("Using USDT:", s_usdt);
        }
    }

    function _configurePool(uint256 deployerPrivateKey, address deployer) internal {
        vm.startBroadcast(deployerPrivateKey);
        WhiteProtocol whiteProtocol = WhiteProtocol(payable(s_whiteProtocol));

        console.log("Adding native asset...");
        whiteProtocol.addSupportedAsset(address(0), false, 18, 0.001 ether, 1000 ether);

        console.log("Adding wrapped native asset...");
        whiteProtocol.addSupportedAsset(s_wrappedNative, false, 18, 0.001 ether, 1000 ether);

        if (s_usdcPresent) {
            console.log("Adding USDC asset...");
            whiteProtocol.addSupportedAsset(s_usdc, false, 6, 1, 1000000 * 10 ** 6);
        }

        if (s_usdtPresent) {
            console.log("Adding USDT asset...");
            // Verify the contract actually exists and exposes ERC20 symbol
            (bool ok, bytes memory data) = s_usdt.staticcall(abi.encodeWithSignature("symbol()"));
            require(ok && data.length > 0, "USDT address has no symbol() - wrong address");
            whiteProtocol.addSupportedAsset(s_usdt, false, 18, 1, 1000000 * 10 ** 18);
            console.log("Registered USDT:", s_usdt);
        }

        console.log("Registering deployer as relayer...");
        whiteProtocol.registerRelayer(deployer);

        vm.stopBroadcast();
    }

    function _verifyAndSave(string memory network, address deployer) internal {
        console.log("============================================================");
        console.log("Post-deploy verification...");

        WhiteProtocol whiteProtocol = WhiteProtocol(payable(s_whiteProtocol));

        uint256 emptyRoot = whiteProtocol.getLastRoot();
        require(
            emptyRoot == EXPECTED_EMPTY_ROOT,
            string.concat(
                "Empty root mismatch: expected ",
                vm.toString(EXPECTED_EMPTY_ROOT),
                ", got ",
                vm.toString(emptyRoot)
            )
        );
        console.log("Empty root verified:", emptyRoot);

        uint256 nextLeaf = whiteProtocol.nextLeafIndex();
        require(nextLeaf == 0, "nextLeafIndex must be 0");
        console.log("nextLeafIndex verified:", nextLeaf);

        require(whiteProtocol.isSupported(address(0)), "Native asset not supported");
        require(whiteProtocol.isSupported(s_wrappedNative), "Wrapped native not supported");
        if (s_usdtPresent) {
            require(whiteProtocol.isSupported(s_usdt), "USDT asset not supported");
        }
        console.log("Asset support verified");

        console.log("============================================================");
        console.log("Deployment successful!");
        console.log("============================================================");

        string memory deployedAt = _toISOString(block.timestamp);
        string memory deploymentPath = string.concat("deployments/", network, ".json");

        string memory root = "deployment";
        vm.serializeString(root, "network", network);
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeString(root, "deployedAt", deployedAt);
        vm.serializeString(root, "deployer", vm.toString(deployer));
        vm.serializeString(root, "contracts", _buildContractsJson());
        vm.serializeString(root, "supportedAssets", _buildAssetsJson());
        vm.serializeString(root, "merkleState", _buildMerkleJson(emptyRoot, nextLeaf));

        address[] memory relayers = new address[](1);
        relayers[0] = deployer;
        vm.serializeUint(root, "domainId", uint256(s_domainId));
        vm.serializeString(root, "domainIdHex", _toHex(s_domainId));
        vm.serializeUint(root, "assetIdVersion", uint256(2));
        vm.serializeString(root, "assetIdFormula", "white:asset_id:v2");
        string memory finalJson = vm.serializeAddress(root, "relayers", relayers);

        vm.writeJson(finalJson, deploymentPath);

        // Fix "null" string to proper JSON null for usdc and usdt
        string memory jsonContent = vm.readFile(deploymentPath);
        jsonContent = _replaceOnce(jsonContent, '"usdc": "null"', '"usdc": null');
        jsonContent = _replaceOnce(jsonContent, '"usdt": "null"', '"usdt": null');
        vm.writeFile(deploymentPath, jsonContent);

        console.log("Deployment saved to:", deploymentPath);
    }

    function _buildContractsJson() internal returns (string memory) {
        string memory obj = "contracts";
        vm.serializeAddress(obj, "WhiteProtocol", s_whiteProtocol);
        vm.serializeAddress(obj, "AssetRegistry", s_assetRegistry);
        vm.serializeAddress(obj, "DepositVerifier", s_depositVerifier);
        vm.serializeAddress(obj, "WithdrawVerifier", s_withdrawVerifier);
        string memory json = vm.serializeAddress(obj, "MerkleBatchVerifier", s_merkleBatchVerifier);
        if (s_wrappedNativeDeployed) {
            json = vm.serializeAddress(obj, "WrappedNative9", s_wrappedNative);
        }
        return json;
    }

    function _buildAssetsJson() internal returns (string memory) {
        string memory obj = "supportedAssets";
        vm.serializeString(obj, "native", "0x0000000000000000000000000000000000000000");
        vm.serializeString(obj, "wrappedNative", vm.toString(s_wrappedNative));
        string memory usdc = s_usdcPresent ? vm.toString(s_usdc) : "null";
        vm.serializeString(obj, "usdc", usdc);
        string memory usdt = s_usdtPresent ? vm.toString(s_usdt) : "null";
        return vm.serializeString(obj, "usdt", usdt);
    }

    function _buildMerkleJson(uint256 emptyRoot, uint256 nextLeaf)
        internal
        returns (string memory)
    {
        string memory obj = "merkleState";
        vm.serializeUintToHex(obj, "emptyRoot", emptyRoot);
        return vm.serializeUint(obj, "nextLeafIndex", nextLeaf);
    }

    function _deployBytecode(string memory contractName)
        internal
        returns (address addr)
    {
        bytes memory bytecode = vm.getCode(contractName);
        assembly {
            addr := create(0, add(bytecode, 0x20), mload(bytecode))
        }
        require(addr != address(0), string.concat("Deploy failed: ", contractName));
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

    function _toHex(uint32 value) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory buf = new bytes(8);
        for (uint256 i = 0; i < 8; i++) {
            buf[7 - i] = hexChars[value & 0xf];
            value >>= 4;
        }
        return string.concat("0x", string(buf));
    }

    function _toISOString(uint256 timestamp)
        internal
        returns (string memory)
    {
        string[] memory inputs = new string[](4);
        inputs[0] = "date";
        inputs[1] = "-u";
        inputs[2] = string.concat("-d@", vm.toString(timestamp));
        inputs[3] = "+%Y-%m-%dT%H:%M:%SZ";
        bytes memory out = vm.ffi(inputs);
        if (out.length > 0 && out[out.length - 1] == 0x0a) {
            bytes memory trimmed = new bytes(out.length - 1);
            for (uint256 i = 0; i < out.length - 1; i++) {
                trimmed[i] = out[i];
            }
            return string(trimmed);
        }
        return string(out);
    }
}
