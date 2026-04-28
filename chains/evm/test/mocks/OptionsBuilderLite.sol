// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title OptionsBuilderLite
 * @dev Minimal type-3 options builder for LayerZero testing.
 *      Does NOT import messagelib or solidity-bytes-utils.
 *      Produces byte-for-byte compatible executor lzReceive options.
 */
library OptionsBuilderLite {
    uint8 internal constant WORKER_ID = 1;
    uint8 internal constant OPTION_TYPE_LZRECEIVE = 1;

    function newOptions() internal pure returns (bytes memory) {
        return abi.encodePacked(uint16(3));
    }

    function addExecutorLzReceiveOption(
        bytes memory _options,
        uint128 _gas,
        uint128 _value
    ) internal pure returns (bytes memory) {
        bytes memory option = _value == 0 ? abi.encodePacked(_gas) : abi.encodePacked(_gas, _value);
        return
            abi.encodePacked(
                _options,
                WORKER_ID,
                uint16(option.length + 1), // +1 for optionType
                OPTION_TYPE_LZRECEIVE,
                option
            );
    }
}
