// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IOwnedRegistry} from "@ensv2/registry/IOwnedRegistry.sol";

/// @notice Minimal `.eth` registry: label owners, subregistries, resolvers.
contract MockEthRegistry is IOwnedRegistry {
    mapping(string => address) public owners;
    mapping(string => IRegistry) public subregistries;
    mapping(string => address) public resolvers;

    function setLabel(string calldata label, address owner, IRegistry sub, address resolver) external {
        owners[label] = owner;
        subregistries[label] = sub;
        resolvers[label] = resolver;
    }

    function findOwner(string calldata label) external view returns (address) {
        return owners[label];
    }

    function getSubregistry(string calldata label) external view returns (IRegistry) {
        return subregistries[label];
    }

    function getResolver(string calldata label) external view returns (address) {
        return resolvers[label];
    }

    function getParent() external pure returns (IRegistry, string memory) {
        return (IRegistry(address(0)), "eth");
    }
}
