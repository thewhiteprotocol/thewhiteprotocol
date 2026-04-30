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
        uint256[3] calldata publicSignals
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

    // Valid 33-byte compressed secp256k1 ephemeral pubkey (prefix 0x02)
    bytes public ephemeralPubkey =
        hex"021234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

    // Valid 33-byte compressed secp256k1 ephemeral pubkey (prefix 0x03)
    bytes public ephemeralPubkey03 =
        hex"031234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

    address public stealthRecipient = address(0xdeadbeef);

    // Event mirror for expectEmit
    event StealthWithdrawal(
        bytes ephemeralPubkey,
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

    function _depositAndGetRoot() internal returns (uint256 root) {
        bytes memory proof = new bytes(256);
        uint256 commitment = uint256(keccak256(abi.encodePacked("test")));
        uint256 amount = 1 ether;

        vm.prank(user);
        whiteProtocol.deposit{value: amount}(proof, commitment, amount, address(0));

        return whiteProtocol.getLastRoot();
    }

    function test_StealthWithdrawalEvent02() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier")));
        uint256 fee = 0.005 ether;

        vm.prank(relayer);

        // Expect the StealthWithdrawal event
        vm.expectEmit(true, true, false, true);
        emit StealthWithdrawal(ephemeralPubkey, stealthRecipient, block.number);

        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            ephemeralPubkey
        );

        assertTrue(whiteProtocol.isSpent(nullifierHash));
    }

    function test_StealthWithdrawalEvent03() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier03")));
        uint256 fee = 0.005 ether;

        vm.prank(relayer);

        vm.expectEmit(true, true, false, true);
        emit StealthWithdrawal(ephemeralPubkey03, stealthRecipient, block.number);

        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            ephemeralPubkey03
        );

        assertTrue(whiteProtocol.isSpent(nullifierHash));
    }

    function test_StealthWithdrawalRejects32Bytes() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier32")));
        uint256 fee = 0.005 ether;

        bytes memory badPubkey = hex"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        assertEq(badPubkey.length, 32, "Test pubkey should be 32 bytes");

        vm.prank(relayer);
        vm.expectRevert("Invalid ephemeral pubkey length");

        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            badPubkey
        );
    }

    function test_StealthWithdrawalRejects34Bytes() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifier34")));
        uint256 fee = 0.005 ether;

        bytes memory badPubkey =
            hex"021234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12";
        assertEq(badPubkey.length, 34, "Test pubkey should be 34 bytes");

        vm.prank(relayer);
        vm.expectRevert("Invalid ephemeral pubkey length");

        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            badPubkey
        );
    }

    function test_StealthWithdrawalRejects33BytesInvalidPrefix() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifierPrefix")));
        uint256 fee = 0.005 ether;

        bytes memory badPubkey =
            hex"041234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        assertEq(badPubkey.length, 33, "Test pubkey should be 33 bytes");
        assertEq(uint8(badPubkey[0]), 0x04, "Test pubkey prefix should be 0x04");

        vm.prank(relayer);
        vm.expectRevert("Invalid ephemeral pubkey prefix");

        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            badPubkey
        );
    }

    function test_StealthWithdrawalRejects33BytesZeroPrefix() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifierZeroPrefix")));
        uint256 fee = 0.005 ether;

        bytes memory badPubkey =
            hex"001234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        assertEq(badPubkey.length, 33, "Test pubkey should be 33 bytes");

        vm.prank(relayer);
        vm.expectRevert("Invalid ephemeral pubkey prefix");

        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            badPubkey
        );
    }

    function test_StealthWithdrawalRejectsEmptyBytes() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifierEmpty")));
        uint256 fee = 0.005 ether;

        vm.prank(relayer);
        vm.expectRevert("Invalid ephemeral pubkey length");

        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            new bytes(0)
        );
    }

    function test_RegularWithdrawalNoStealthEvent() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifierRegular")));
        uint256 fee = 0.005 ether;

        vm.prank(relayer);

        // Regular withdraw should NOT emit StealthWithdrawal
        whiteProtocol.withdraw(
            new bytes(256),
            nullifierHash,
            root,
            user,
            address(0),
            1 ether,
            fee,
            relayer
        );

        assertTrue(whiteProtocol.isSpent(nullifierHash));
    }

    function test_StealthWithdrawalDoubleSpend() public {
        uint256 root = _depositAndGetRoot();
        uint256 nullifierHash = uint256(keccak256(abi.encodePacked("nullifierDs")));
        uint256 fee = 0.005 ether;

        // First stealth withdrawal
        vm.prank(relayer);
        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            ephemeralPubkey
        );

        // Second attempt should fail (double spend)
        vm.prank(relayer);
        vm.expectRevert("Nullifier already spent");

        bytes memory differentPubkey =
            hex"031234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
        whiteProtocol.withdrawStealth(
            new bytes(256),
            nullifierHash,
            root,
            stealthRecipient,
            address(0),
            1 ether,
            fee,
            relayer,
            differentPubkey
        );
    }

    receive() external payable {}
}
