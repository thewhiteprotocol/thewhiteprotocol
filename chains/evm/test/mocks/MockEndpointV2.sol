// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { MessagingParams, MessagingFee, MessagingReceipt, Origin } from "@layerzerolabs/lz-evm-protocol-v2/contracts/interfaces/ILayerZeroEndpointV2.sol";
import { OAppReceiver } from "@layerzerolabs/oapp-evm/contracts/oapp/OAppReceiver.sol";

/**
 * @title MockLzNetwork
 * @dev Shared message broker between mock endpoints.
 *      Stores outbound messages and allows delivery through any destination endpoint.
 */
contract MockLzNetwork {
    struct Message {
        uint32 srcEid;
        bytes32 sender;
        uint64 nonce;
        address receiver;
        bytes32 guid;
        bytes message;
    }

    Message[] public messages;

    function send(
        uint32 srcEid,
        address sender,
        MessagingParams calldata params,
        address refundAddress
    ) external payable returns (MessagingReceipt memory) {
        uint64 nonce = uint64(messages.length + 1);
        bytes32 guid = keccak256(
            abi.encodePacked(
                nonce,
                srcEid,
                bytes32(uint256(uint160(sender))),
                params.dstEid,
                params.receiver
            )
        );

        messages.push(
            Message({
                srcEid: srcEid,
                sender: bytes32(uint256(uint160(sender))),
                nonce: nonce,
                receiver: address(uint160(uint256(params.receiver))),
                guid: guid,
                message: params.message
            })
        );

        if (msg.value > 0) {
            (bool success, ) = refundAddress.call{value: msg.value}("");
            require(success, "refund failed");
        }

        return MessagingReceipt(guid, nonce, MessagingFee(0, 0));
    }

    function verifyPackets(MockEndpointV2 dstEndpoint, address receiver) external {
        uint256 len = messages.length;
        for (uint256 i = 0; i < len; i++) {
            Message memory m = messages[i];
            Origin memory origin = Origin(m.srcEid, m.sender, m.nonce);
            dstEndpoint.deliver(receiver, origin, m.guid, m.message);
        }
        delete messages;
    }
}

/**
 * @title MockEndpointV2
 * @dev Minimal mock LayerZero EndpointV2 for Foundry testing.
 *      Forwards sends to a shared MockLzNetwork and can deliver
 *      inbound messages so that OAppReceiver.OnlyEndpoint passes.
 */
contract MockEndpointV2 {
    uint32 public eid;
    address public delegate;
    MockLzNetwork public network;

    constructor(uint32 _eid, MockLzNetwork _network) {
        eid = _eid;
        network = _network;
    }

    function quote(MessagingParams calldata, address) external pure returns (MessagingFee memory) {
        return MessagingFee(0.01 ether, 0);
    }

    function send(
        MessagingParams calldata _params,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory) {
        return network.send{value: msg.value}(eid, msg.sender, _params, _refundAddress);
    }

    function deliver(address _receiver, Origin calldata _origin, bytes32 _guid, bytes calldata _message) external {
        OAppReceiver(_receiver).lzReceive(_origin, _guid, _message, address(this), bytes(""));
    }

    function setDelegate(address _delegate) external {
        delegate = _delegate;
    }

    function lzToken() external pure returns (address) {
        return address(0);
    }

    receive() external payable {}
}
