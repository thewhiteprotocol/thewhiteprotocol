// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/WhiteProtocol.sol";
import "../contracts/AssetRegistry.sol";
import "../contracts/MerkleTreeWithHistory.sol";

// Mock verifier that always returns true (for testing)
contract MockVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[1] calldata publicSignals
    ) external pure returns (bool) {
        return true;
    }
}

contract MockWithdrawVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[8] calldata publicSignals
    ) external pure returns (bool) {
        return true;
    }
}

contract MockMerkleBatchVerifier {
    function verifyProof(
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c,
        uint256[5] calldata publicSignals
    ) external pure returns (bool) {
        return true;
    }
}

contract WhiteProtocolTest is Test {
    WhiteProtocol public whiteProtocol;
    AssetRegistry public assetRegistry;
    MockVerifier public depositVerifier;
    MockWithdrawVerifier public withdrawVerifier;
    MockMerkleBatchVerifier public merkleBatchVerifier;
    
    address public owner = address(1);
    address public user = address(2);
    address public relayer = address(3);
    
    // Mock ERC20 token
    address public mockToken;

    function setUp() public {
        vm.startPrank(owner);
        
        // Deploy verifiers
        depositVerifier = new MockVerifier();
        withdrawVerifier = new MockWithdrawVerifier();
        merkleBatchVerifier = new MockMerkleBatchVerifier();
        
        // Deploy asset registry
        assetRegistry = new AssetRegistry(owner);
        
        // Deploy main contract
        whiteProtocol = new WhiteProtocol(
            owner,
            address(depositVerifier),
            address(withdrawVerifier),
            address(merkleBatchVerifier),
            address(assetRegistry)
        );
        
        // Add ETH as supported asset
        assetRegistry.addAsset(address(0), false, 18, 0.001 ether, 100 ether);
        
        // Register relayer
        whiteProtocol.registerRelayer(relayer);
        
        vm.stopPrank();
        
        // Fund user
        vm.deal(user, 10 ether);
    }

    function test_DepositETH() public {
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;
        
        vm.prank(user);
        whiteProtocol.deposit{value: amount}(proof, commitment, amount, address(0));
        
        assertEq(whiteProtocol.getPendingDepositsCount(), 1);
        assertEq(whiteProtocol.getPendingDeposit(0), commitment);
    }

    function test_RevertDeposit_WrongETHAmount() public {
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;
        
        vm.prank(user);
        vm.expectRevert("ETH amount mismatch");
        whiteProtocol.deposit{value: 0.5 ether}(proof, commitment, amount, address(0));
    }

    function test_RevertDeposit_UnsupportedAsset() public {
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;
        address unsupportedToken = address(0x999);
        
        vm.prank(user);
        vm.expectRevert("Asset not supported");
        whiteProtocol.deposit{value: amount}(proof, commitment, amount, unsupportedToken);
    }

    function test_WithdrawETH() public {
        // First deposit
        test_DepositETH();
        
        // Get current root
        uint256 root = whiteProtocol.getLastRoot();
        
        // Prepare withdrawal
        bytes memory proof = new bytes(256);
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 amount = 1 ether;
        uint256 fee = 0.005 ether; // 0.5%
        
        uint256 initialBalance = user.balance;
        
        vm.prank(relayer);
        whiteProtocol.withdraw(
            proof,
            nullifierHash,
            root,
            user,
            address(0),
            amount,
            fee,
            relayer
        );
        
        // Check nullifier is spent
        assertTrue(whiteProtocol.isSpent(nullifierHash));
        
        // Check user received funds (minus fee)
        assertEq(user.balance, initialBalance + amount - fee);
    }

    function test_RevertWithdraw_DoubleSpend() public {
        test_WithdrawETH();
        
        bytes memory proof = new bytes(256);
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 root = whiteProtocol.getLastRoot();
        
        vm.prank(relayer);
        vm.expectRevert("Nullifier already spent");
        whiteProtocol.withdraw(
            proof,
            nullifierHash,
            root,
            user,
            address(0),
            1 ether,
            0.005 ether,
            relayer
        );
    }

    function test_RevertWithdraw_UnknownRoot() public {
        test_DepositETH();
        
        bytes memory proof = new bytes(256);
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 fakeRoot = uint256(keccak256(abi.encodePacked("fake")));
        
        vm.prank(relayer);
        vm.expectRevert("Unknown Merkle root");
        whiteProtocol.withdraw(
            proof,
            nullifierHash,
            fakeRoot,
            user,
            address(0),
            1 ether,
            0.005 ether,
            relayer
        );
    }

    function test_RegisterAndRemoveRelayer() public {
        address newRelayer = address(4);
        
        // Register
        vm.prank(owner);
        whiteProtocol.registerRelayer(newRelayer);
        assertTrue(whiteProtocol.isRelayer(newRelayer));
        
        // Remove
        vm.prank(owner);
        whiteProtocol.removeRelayer(newRelayer);
        assertFalse(whiteProtocol.isRelayer(newRelayer));
    }

    function test_RevertUnauthorizedRelayerRegistration() public {
        vm.prank(user);
        vm.expectRevert();
        whiteProtocol.registerRelayer(address(4));
    }

    function test_MerkleTreeBasics() public {
        // Check initial state
        assertEq(whiteProtocol.getLastRoot(), whiteProtocol.zeros(20));
        assertEq(whiteProtocol.nextLeafIndex(), 0);
        
        // Insert a leaf
        uint256 leaf = uint256(keccak256(abi.encodePacked("test")));
        uint256 newRoot = whiteProtocol.insert(leaf);
        
        // Check state updated
        assertEq(whiteProtocol.getLastRoot(), newRoot);
        assertEq(whiteProtocol.nextLeafIndex(), 1);
        
        // Check root is known
        assertTrue(whiteProtocol.isKnownRoot(newRoot));
    }

    function test_AssetRegistry() public {
        // Check ETH is supported
        assertTrue(assetRegistry.isSupported(address(0)));
        
        // Add new asset
        address newToken = address(0x123);
        vm.prank(owner);
        assetRegistry.addAsset(newToken, true, 18, 1 ether, 1000 ether);
        
        assertTrue(assetRegistry.isSupported(newToken));
        assertTrue(assetRegistry.isYieldAsset(newToken));
        assertEq(assetRegistry.getAssetCount(), 2);
    }

    function test_RevertAddAsset_Duplicate() public {
        vm.prank(owner);
        vm.expectRevert("Asset already supported");
        assetRegistry.addAsset(address(0), false, 18, 0, 0);
    }

    receive() external payable {}
}
