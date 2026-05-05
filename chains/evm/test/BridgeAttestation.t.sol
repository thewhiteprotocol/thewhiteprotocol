// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/libraries/BridgeAttestationLib.sol";

/// @dev Wrapper so library calls happen at a lower depth for expectRevert
contract BridgeAttestationLibWrapper {
    function verifyThresholdSignatures(
        bytes32 messageHash,
        bytes[] memory signatures,
        BridgeAttestationLib.SignerSet memory signerSet
    ) external pure returns (uint256) {
        return BridgeAttestationLib.verifyThresholdSignatures(messageHash, signatures, signerSet);
    }

    function validateSignerSet(address[] memory signers, uint256 threshold) external pure {
        BridgeAttestationLib.validateSignerSet(signers, threshold);
    }
}

contract BridgeAttestationTest is Test {
    BridgeAttestationLibWrapper internal wrapper = new BridgeAttestationLibWrapper();

    // Test private keys (distinct)
    uint256 signer1Key = 0xaaa;
    uint256 signer2Key = 0xbbb;
    uint256 signer3Key = 0xccc;
    uint256 attackerKey = 0xddd;

    address signer1;
    address signer2;
    address signer3;
    address attacker;

    bytes32 testHash = keccak256("test message");

    function setUp() public {
        signer1 = vm.addr(signer1Key);
        signer2 = vm.addr(signer2Key);
        signer3 = vm.addr(signer3Key);
        attacker = vm.addr(attackerKey);
    }

    function _makeSignerSet(address[] memory signers, uint256 threshold)
        internal
        pure
        returns (BridgeAttestationLib.SignerSet memory)
    {
        return BridgeAttestationLib.SignerSet({
            signers: signers,
            threshold: threshold,
            version: 1
        });
    }

    function _sign(bytes32 hash, uint256 privateKey) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, hash);
        return abi.encodePacked(r, s, v);
    }

    // 1. 2-of-3 valid signatures pass
    function test_Valid2of3_Sorted_Passes() public {
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        // Sort signers to ensure ascending order
        if (signers[0] > signers[1]) (signers[0], signers[1]) = (signers[1], signers[0]);
        if (signers[1] > signers[2]) (signers[1], signers[2]) = (signers[1], signers[2]);
        if (signers[0] > signers[1]) (signers[0], signers[1]) = (signers[1], signers[0]);

        bytes[] memory sigs = new bytes[](2);
        // Sign in sorted order
        if (signers[0] == signer1) {
            sigs[0] = _sign(testHash, signer1Key);
        } else if (signers[0] == signer2) {
            sigs[0] = _sign(testHash, signer2Key);
        } else {
            sigs[0] = _sign(testHash, signer3Key);
        }

        if (signers[1] == signer1) {
            sigs[1] = _sign(testHash, signer1Key);
        } else if (signers[1] == signer2) {
            sigs[1] = _sign(testHash, signer2Key);
        } else {
            sigs[1] = _sign(testHash, signer3Key);
        }

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 2);
        uint256 validCount = wrapper.verifyThresholdSignatures(testHash, sigs, set);
        assertEq(validCount, 2);
    }

    // 2. 1-of-3 fails
    function test_Threshold2of3_1Sig_Fails() public {
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        bytes[] memory sigs = new bytes[](1);
        sigs[0] = _sign(testHash, signer1Key);

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 2);

        vm.expectRevert(BridgeAttestationLib.ThresholdNotMet.selector);
        wrapper.verifyThresholdSignatures(testHash, sigs, set);
    }

    // 3. Duplicate signer signatures fail (unsorted)
    function test_DuplicateSigner_Fails() public {
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(testHash, signer1Key);
        sigs[1] = _sign(testHash, signer1Key); // duplicate

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 2);

        vm.expectRevert(BridgeAttestationLib.SignaturesNotSorted.selector);
        wrapper.verifyThresholdSignatures(testHash, sigs, set);
    }

    // 4. Unknown signer fails
    function test_UnknownSigner_Fails() public {
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(testHash, signer1Key);
        sigs[1] = _sign(testHash, attackerKey); // unknown

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 2);

        vm.expectRevert(BridgeAttestationLib.InvalidSigner.selector);
        wrapper.verifyThresholdSignatures(testHash, sigs, set);
    }

    // 5. Invalid signature fails (bad bytes)
    function test_InvalidSignature_Fails() public {
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(testHash, signer1Key);
        // 65-byte signature with r=0, s=0, v=27 — ecrecover returns address(0)
        sigs[1] = abi.encodePacked(bytes32(0), bytes32(0), uint8(0x1b));

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 2);

        vm.expectRevert(ECDSA.ECDSAInvalidSignature.selector);
        wrapper.verifyThresholdSignatures(testHash, sigs, set);
    }

    // 6. Wrong message hash fails
    function test_WrongMessageHash_Fails() public {
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        bytes32 wrongHash = keccak256("wrong message");
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = _sign(testHash, signer1Key);
        sigs[1] = _sign(testHash, signer2Key);

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 2);

        // Signatures are for testHash, but we verify against wrongHash
        vm.expectRevert(BridgeAttestationLib.InvalidSigner.selector);
        wrapper.verifyThresholdSignatures(wrongHash, sigs, set);
    }

    // 7. Threshold cannot exceed signer count
    function test_ThresholdExceedsSigners_Fails() public {
        address[] memory signers = new address[](2);
        signers[0] = signer1;
        signers[1] = signer2;

        vm.expectRevert(BridgeAttestationLib.InvalidThreshold.selector);
        wrapper.validateSignerSet(signers, 3);
    }

    // 8. Signer set cannot contain zero address
    function test_ZeroSigner_Fails() public {
        address[] memory signers = new address[](2);
        signers[0] = signer1;
        signers[1] = address(0);

        vm.expectRevert(BridgeAttestationLib.ZeroSigner.selector);
        wrapper.validateSignerSet(signers, 1);
    }

    // 9. Signer set cannot contain duplicates
    function test_DuplicateInSignerSet_Fails() public {
        address[] memory signers = new address[](2);
        signers[0] = signer1;
        signers[1] = signer1;

        vm.expectRevert(BridgeAttestationLib.DuplicateSigner.selector);
        wrapper.validateSignerSet(signers, 1);
    }

    // 10. Empty signer set fails
    function test_EmptySignerSet_Fails() public {
        address[] memory signers = new address[](0);

        vm.expectRevert(BridgeAttestationLib.EmptySignerSet.selector);
        wrapper.validateSignerSet(signers, 1);
    }

    // 11. Zero threshold fails
    function test_ZeroThreshold_Fails() public {
        address[] memory signers = new address[](2);
        signers[0] = signer1;
        signers[1] = signer2;

        vm.expectRevert(BridgeAttestationLib.InvalidThreshold.selector);
        wrapper.validateSignerSet(signers, 0);
    }

    // 12. Unsorted signatures fail
    function test_UnsortedSignatures_Fails() public {
        address[] memory signers = new address[](3);
        signers[0] = signer1;
        signers[1] = signer2;
        signers[2] = signer3;

        // Sort signers
        if (signers[0] > signers[1]) (signers[0], signers[1]) = (signers[1], signers[0]);
        if (signers[1] > signers[2]) (signers[1], signers[2]) = (signers[1], signers[2]);
        if (signers[0] > signers[1]) (signers[0], signers[1]) = (signers[1], signers[0]);

        bytes[] memory sigs = new bytes[](2);
        // Intentionally swap order: sign with higher-address signer first
        if (signers[1] == signer1) {
            sigs[0] = _sign(testHash, signer1Key);
        } else if (signers[1] == signer2) {
            sigs[0] = _sign(testHash, signer2Key);
        } else {
            sigs[0] = _sign(testHash, signer3Key);
        }

        if (signers[0] == signer1) {
            sigs[1] = _sign(testHash, signer1Key);
        } else if (signers[0] == signer2) {
            sigs[1] = _sign(testHash, signer2Key);
        } else {
            sigs[1] = _sign(testHash, signer3Key);
        }

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 2);

        vm.expectRevert(BridgeAttestationLib.SignaturesNotSorted.selector);
        wrapper.verifyThresholdSignatures(testHash, sigs, set);
    }

    // 13. 5-of-7 threshold simulation
    function test_Threshold5of7_Passes() public {
        // Generate 7 signers
        address[] memory signers = new address[](7);
        uint256[] memory keys = new uint256[](7);
        for (uint256 i = 0; i < 7; i++) {
            keys[i] = uint256(keccak256(abi.encodePacked("signer", i)));
            signers[i] = vm.addr(keys[i]);
        }

        // Sort signers by address
        for (uint256 i = 0; i < signers.length; i++) {
            for (uint256 j = i + 1; j < signers.length; j++) {
                if (signers[i] > signers[j]) {
                    (signers[i], signers[j]) = (signers[j], signers[i]);
                    (keys[i], keys[j]) = (keys[j], keys[i]);
                }
            }
        }

        bytes[] memory sigs = new bytes[](5);
        for (uint256 i = 0; i < 5; i++) {
            sigs[i] = _sign(testHash, keys[i]);
        }

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 5);
        uint256 validCount = wrapper.verifyThresholdSignatures(testHash, sigs, set);
        assertEq(validCount, 5);
    }

    // 14. 5-of-7 with 4 sigs fails
    function test_Threshold5of7_4Sigs_Fails() public {
        address[] memory signers = new address[](7);
        uint256[] memory keys = new uint256[](7);
        for (uint256 i = 0; i < 7; i++) {
            keys[i] = uint256(keccak256(abi.encodePacked("signer", i)));
            signers[i] = vm.addr(keys[i]);
        }

        for (uint256 i = 0; i < signers.length; i++) {
            for (uint256 j = i + 1; j < signers.length; j++) {
                if (signers[i] > signers[j]) {
                    (signers[i], signers[j]) = (signers[j], signers[i]);
                    (keys[i], keys[j]) = (keys[j], keys[i]);
                }
            }
        }

        bytes[] memory sigs = new bytes[](4);
        for (uint256 i = 0; i < 4; i++) {
            sigs[i] = _sign(testHash, keys[i]);
        }

        BridgeAttestationLib.SignerSet memory set = _makeSignerSet(signers, 5);

        vm.expectRevert(BridgeAttestationLib.ThresholdNotMet.selector);
        wrapper.verifyThresholdSignatures(testHash, sigs, set);
    }
}
