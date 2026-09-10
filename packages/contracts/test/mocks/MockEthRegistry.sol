// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IOwnedRegistry} from "@ensv2/registry/IOwnedRegistry.sol";

/// @notice Minimal `.eth` registry: label owners, subregistries, resolvers.
contract MockEthRegistry is IOwnedRegistry {
    mapping(string => address) public owners;
    mapping(string => IRegistry) public subregistries;
    mapping(string => address) public resolvers;
    mapping(uint256 => address) public byId;

    function setLabel(string calldata label, address owner, IRegistry sub, address resolver) external {
        owners[label] = owner;
        subregistries[label] = sub;
        resolvers[label] = resolver;
    }

    function findOwner(string calldata label) external view returns (address) {
        return owners[label];
    }

    /// @dev ENSv2 addresses a name by token id: the labelhash with the version bits cleared.
    function tokenId(string memory label) public pure returns (uint256) {
        return uint256(keccak256(bytes(label))) & ~uint256(type(uint32).max);
    }

    /// @notice Re-point the resolver of a registered name, as the real ETHRegistry does.
    function setResolver(uint256 id, address resolver) external {
        byId[id] = resolver;
    }

    function getSubregistry(string calldata label) external view returns (IRegistry) {
        return subregistries[label];
    }

    function getResolver(string calldata label) external view returns (address) {
        address byToken = byId[tokenId(label)];
        return byToken == address(0) ? resolvers[label] : byToken;
    }

    function getParent() external pure returns (IRegistry, string memory) {
        return (IRegistry(address(0)), "eth");
    }
}
