// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";

/// @notice A level of the namespace that holds no records: `www`, `com`, `@`. It exists to be walked
///         through, so it answers subregistries and its own parent and nothing else.
///
///         Grouping levels are shared. `x.com.www.<root>` is one instance for every account on X,
///         not one per person, and adding a platform costs a single mount here.
contract GroupingRegistry is IRegistry, Ownable {
    IRegistry public immutable PARENT;
    string internal _parentLabel;
    mapping(bytes32 labelHash => IRegistry) internal _subregistries;

    constructor(IRegistry parent, string memory parentLabel, address owner) Ownable(owner) {
        PARENT = parent;
        _parentLabel = parentLabel;
        emit RegistryCreated();
    }

    /// @notice Mount (or unmount with `address(0)`) a child registry under `label`.
    function setSubregistry(string calldata label, IRegistry sub) external onlyOwner {
        _subregistries[keccak256(bytes(label))] = sub;
        emit SubregistryUpdated(uint256(keccak256(bytes(label))), sub, msg.sender);
    }

    /// @inheritdoc IRegistry
    function getSubregistry(string calldata label) external view returns (IRegistry) {
        return _subregistries[keccak256(bytes(label))];
    }

    /// @inheritdoc IRegistry
    /// @dev Nothing resolves at a grouping level itself: `www.<root>` is a path, not a name.
    function getResolver(string calldata) external pure returns (address) {
        return address(0);
    }

    /// @inheritdoc IRegistry
    function getParent() external view returns (IRegistry, string memory) {
        return (PARENT, _parentLabel);
    }
}
