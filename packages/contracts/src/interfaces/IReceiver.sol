// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal Chainlink CRE consumer interface: the KeystoneForwarder delivers a DON report here.
///         Copied from the Chainlink docs; the receiver contracts are not published as a Forge package.
interface IReceiver {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
