// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Multipass names are left-aligned, zero-padded bytes32 (<= 31 bytes).
library LibLabel {
    function toBytes32(bytes memory label) internal pure returns (bool fits, bytes32 out) {
        if (label.length == 0 || label.length > 31) return (false, bytes32(0));
        assembly {
            out := mload(add(label, 32))
        }
        return (true, out);
    }

    function fromBytes32(bytes32 value) internal pure returns (string memory) {
        uint256 len;
        while (len < 32 && value[len] != 0) {
            ++len;
        }
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = value[i];
        }
        return string(out);
    }
}
