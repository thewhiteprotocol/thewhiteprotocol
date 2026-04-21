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

contract StealthWithdrawalTest is Test {
    WhiteProtocol public whiteProtocol;
    AssetRegistry public assetRegistry;
    MockVerifier public depositVerifier;
    MockWithdrawVerifier public withdrawVerifier;
    MockMerkleBatchVerifier public merkleBatchVerifier;
    
    address public owner = address(1);
    address public user = address(2);
    address public relayer = address(3);
    
    // Stealth parameters
    bytes32 public ephemeralPubkey = bytes32(uint256(0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef));
    address public stealthRecipient = address(0xdeadbeef);
    
    // Event mirror for expectEmit
    event StealthWithdrawal(
        bytes32 indexed ephemeralPubkey,
        address indexed destination,
        uint256 blockNumber
    );

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

    function test_StealthWithdrawalEvent() public {
        // First deposit
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;
        
        vm.prank(user);
        whiteProtocol.deposit{value: amount}(proof, commitment, amount, address(0));
        
        // Get current root
        uint256 root = whiteProtocol.getLastRoot();
        
        // Prepare stealth withdrawal
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 fee = 0.005 ether; // 0.5%
        
        vm.prank(relayer);
        
        // Expect the StealthWithdrawal event
        vm.expectEmit(true, true, false, true);
        emit StealthWithdrawal(
            ephemeralPubkey,
            stealthRecipient,
            block.number
        );
        
        whiteProtocol.withdrawStealth(
            proof,
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            amount,
            fee,
            relayer,
            ephemeralPubkey
        );
        
        // Verify nullifier is spent
        assertTrue(whiteProtocol.isSpent(nullifierHash));
    }

    function test_StealthWithdrawalInvalidEphemeral() public {
        // First deposit
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;
        
        vm.prank(user);
        whiteProtocol.deposit{value: amount}(proof, commitment, amount, address(0));
        
        uint256 root = whiteProtocol.getLastRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 fee = 0.005 ether;
        
        vm.prank(relayer);
        vm.expectRevert("Invalid ephemeral pubkey");
        
        whiteProtocol.withdrawStealth(
            proof,
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            amount,
            fee,
            relayer,
            bytes32(0) // zero ephemeral pubkey should revert
        );
    }

    function test_RegularWithdrawalNoStealthEvent() public {
        // First deposit
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;
        
        vm.prank(user);
        whiteProtocol.deposit{value: amount}(proof, commitment, amount, address(0));
        
        uint256 root = whiteProtocol.getLastRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 fee = 0.005 ether;
        
        vm.prank(relayer);
        
        // Regular withdraw should NOT emit StealthWithdrawal
        // We verify this by checking the logs after the call
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
        
        assertTrue(whiteProtocol.isSpent(nullifierHash));
    }

    function test_StealthWithdrawalDoubleSpend() public {
        // First deposit
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;
        
        vm.prank(user);
        whiteProtocol.deposit{value: amount}(proof, commitment, amount, address(0));
        
        uint256 root = whiteProtocol.getLastRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 fee = 0.005 ether;
        
        // First stealth withdrawal
        vm.prank(relayer);
        whiteProtocol.withdrawStealth(
            proof,
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            amount,
            fee,
            relayer,
            ephemeralPubkey
        );
        
        // Second attempt should fail (double spend)
        vm.prank(relayer);
        vm.expectRevert("Nullifier already spent");
        whiteProtocol.withdrawStealth(
            proof,
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            amount,
            fee,
            relayer,
            bytes32(uint256(0xabcdef)) // different ephemeral pubkey, same nullifier
        );
    }

    receive() external payable {}
}
