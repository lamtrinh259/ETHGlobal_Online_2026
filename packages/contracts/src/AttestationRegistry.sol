// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {LibLabel} from "./libraries/LibLabel.sol";

/// @notice ENSv2 subname registry for one attestation instance: every label under the parent name
///         resolves iff a live Multipass record exists for it in `DOMAIN`. Expiry is enforced here
///         because Multipass `resolveRecord` does not check `validUntil`. No tokens, no transfers.
///
///         Subregistries let an instance nest others (e.g. a subject namespace under a root); they
///         are set by the owner, typically the factory operator, and never derived from records.
contract AttestationRegistry is IRegistry, Ownable {
    /// @notice Which records this mount answers for. A platform's public branch under `www` names
    ///         accounts by their handle, so it must stay silent about an account someone chose to mask:
    ///         that one is a one-time pad over the handle, and it is represented, by the person's own
    ///         name, in `MaskedMirrorRegistry`. A masked record carries a view-code commitment as its
    ///         payload. `Any` is for a name domain, where the payload is the person's answer.
    enum Visibility {
        Any,
        Public
    }

    IMultipass public immutable MP;
    Visibility public immutable VISIBILITY;
    bytes32 public immutable DOMAIN;
    address public immutable RESOLVER;
    IRegistry public immutable PARENT;
    string internal _parentLabel;
    mapping(bytes32 labelHash => IRegistry) internal _subregistries;

    constructor(
        IMultipass mp,
        bytes32 domain,
        address resolver,
        IRegistry parent,
        string memory parentLabel,
        address owner,
        Visibility visibility
    ) Ownable(owner) {
        MP = mp;
        VISIBILITY = visibility;
        DOMAIN = domain;
        RESOLVER = resolver;
        PARENT = parent;
        _parentLabel = parentLabel;
        emit RegistryCreated();
    }

    /// @notice Mount (or unmount with `address(0)`) a child instance under `label`.
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
        (bool ok, LibMultipass.Record memory r) =
            MP.resolveRecord(LibMultipass.NameQuery(DOMAIN, address(0), name, bytes32(0), bytes32(0)));
        if (!ok || r.validUntil <= block.timestamp) return address(0);
        if (VISIBILITY == Visibility.Public && r.payload != bytes32(0)) return address(0);
        return RESOLVER;
    }

    /// @inheritdoc IRegistry
    function getParent() external view returns (IRegistry, string memory) {
        return (PARENT, _parentLabel);
    }
}
