// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev A DNS name is mounted first label first — `x.com` walks `www` → `x` → `com` — so a service
///      that hands out subdomains keeps them apart: `tenant.acme.com` is its own chain rather than a
///      level inside the accounts of `acme.com`. Reading an ENS name is the reverse walk, which is why
///      `join` puts the labels back in the opposite order.
library LibNamespace {
    error EmptyLabel(string dns);

    /// @notice Split a DNS name into its labels, left to right: "x.com" → ["x", "com"].
    function split(string memory dns) internal pure returns (string[] memory labels) {
        bytes memory raw = bytes(dns);
        uint256 count = 1;
        for (uint256 i; i < raw.length; ++i) {
            if (raw[i] == ".") ++count;
        }
        labels = new string[](count);
        uint256 start;
        uint256 at;
        for (uint256 i; i <= raw.length; ++i) {
            if (i == raw.length || raw[i] == ".") {
                if (i == start) revert EmptyLabel(dns);
                bytes memory label = new bytes(i - start);
                for (uint256 j; j < label.length; ++j) {
                    label[j] = raw[start + j];
                }
                labels[at++] = string(label);
                start = i + 1;
            }
        }
    }

    /// @notice The ENS name of a mount: the walk read backwards, under `suffix`.
    ///         `["www", "x", "com"]` with `acme.eth` → `com.x.www.acme.eth`.
    function join(string[] memory walk, string memory suffix) internal pure returns (string memory name) {
        name = suffix;
        for (uint256 i; i < walk.length; ++i) {
            name = string.concat(walk[i], ".", name);
        }
    }
}
