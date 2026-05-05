// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { BridgeMessageLib } from "../libraries/BridgeMessageLib.sol";

/**
 * @title IWhiteProtocolBridge
 * @notice Minimal interface for WhiteProtocol bridge hooks.
 */
interface IWhiteProtocolBridge {
    function bridgeMint(address asset, uint256 amount, bytes32 newCommitment) external;
    function bridgeOutV1(bytes calldata proof, BridgeMessageLib.BridgeMessageV1 calldata message, address asset) external;
}
