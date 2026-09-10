// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {LibLabel} from "./libraries/LibLabel.sol";

/// @notice The private half of a platform's namespace: `alice.com.x.private-www.<root>` says that the
///         person who holds `alice.<root>` has an account on X, and nothing more. The account's own
///         handle stays behind the view code it was masked with.
///
///         The label is the person's name, not the account's, because a masked name is a one-time pad
///         over the handle: unreadable, and the whole point is that it stays that way. So this registry
///         answers a name-domain label, then checks that the wallet holding it also holds a masked
///         record in the platform domain. Both have to be live.
contract MaskedMirrorRegistry is IRegistry, Ownable {
    IMultipass public immutable MP;
    /// @notice Domain the label is looked up in: the root instance where people hold their names
    bytes32 public immutable NAME_DOMAIN;
    /// @notice Platform domain the masked account must exist in
    bytes32 public immutable DOMAIN;
    address public immutable RESOLVER;
    IRegistry public immutable PARENT;
    string internal _parentLabel;
    mapping(bytes32 labelHash => IRegistry) internal _subregistries;

    constructor(
        IMultipass mp,
        bytes32 nameDomain,
        bytes32 domain,
        address resolver,
        IRegistry parent,
        string memory parentLabel,
        address owner
    ) Ownable(owner) {
        MP = mp;
        NAME_DOMAIN = nameDomain;
        DOMAIN = domain;
        RESOLVER = resolver;
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
    function getResolver(string calldata label) external view returns (address) {
        (bool fits, bytes32 name) = LibLabel.toBytes32(bytes(label));
        if (!fits) return address(0);
        (bool held, LibMultipass.Record memory person) =
            MP.resolveRecord(LibMultipass.NameQuery(NAME_DOMAIN, address(0), name, bytes32(0), bytes32(0)));
        if (!held || person.validUntil <= block.timestamp) return address(0);
        (bool has, LibMultipass.Record memory account) =
            MP.resolveRecord(LibMultipass.NameQuery(DOMAIN, person.wallet, bytes32(0), bytes32(0), bytes32(0)));
        if (!has || account.validUntil <= block.timestamp) return address(0);
        // A public account belongs in the branch that names it; only a masked one is represented here.
        if (account.payload == bytes32(0)) return address(0);
        return RESOLVER;
    }

    /// @inheritdoc IRegistry
    function getParent() external view returns (IRegistry, string memory) {
        return (PARENT, _parentLabel);
    }
}
