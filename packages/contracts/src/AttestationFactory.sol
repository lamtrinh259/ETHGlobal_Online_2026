// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {AttestationRegistry} from "./AttestationRegistry.sol";
import {AttestationResolver} from "./AttestationResolver.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";

/// @notice Deploys one attestation instance per Multipass domain: a registry + resolver pair bound to
///         an ENS parent name. The subject of the instance (a person namespace, a question, an
///         organisation) is a deployment argument, never a source artifact.
///
///         After `create` the operator still has to (1) `initializeDomain` on Multipass with the
///         registrar key, (2) `setSubregistry` on the parent registry, (3) hold resolver roles for the
///         bridge. `script/DeployInstance.s.sol` does all four in order.
contract AttestationFactory is Ownable {
    struct Instance {
        AttestationRegistry registry;
        AttestationResolver resolver;
        IRegistry parent;
        string parentLabel;
        string parentName;
    }

    IMultipass public immutable MP;
    mapping(bytes32 domain => Instance) internal _instances;
    bytes32[] internal _domains;

    event InstanceCreated(
        bytes32 indexed domain,
        address registry,
        address resolver,
        address parent,
        string parentLabel,
        string parentName
    );

    error InstanceExists(bytes32 domain);
    error UnknownInstance(bytes32 domain);

    constructor(IMultipass mp, address owner) Ownable(owner) {
        MP = mp;
    }

    /// @param domain      Multipass domain the instance reads (e.g. "kju-is", "acme-alumni")
    /// @param parent      ENSv2 registry the instance mounts under
    /// @param parentLabel Label of the instance in `parent` (e.g. "kju-is")
    /// @param parentName  Full parent name for reverse resolution (e.g. "kju-is.eth")
    /// @param inner       Stock PermissionedResolver the resolver forwards to
    function create(
        bytes32 domain,
        IRegistry parent,
        string calldata parentLabel,
        string calldata parentName,
        IPermissionedResolver inner
    ) external onlyOwner returns (AttestationRegistry registry, AttestationResolver resolver) {
        if (address(_instances[domain].registry) != address(0)) revert InstanceExists(domain);
        resolver = new AttestationResolver(MP, inner, domain, parentName);
        registry = new AttestationRegistry(MP, domain, address(resolver), parent, parentLabel, owner());
        _instances[domain] = Instance(registry, resolver, parent, parentLabel, parentName);
        _domains.push(domain);
        emit InstanceCreated(domain, address(registry), address(resolver), address(parent), parentLabel, parentName);
    }

    function instance(bytes32 domain) external view returns (Instance memory) {
        return _instances[domain];
    }

    function domains() external view returns (bytes32[] memory) {
        return _domains;
    }

    /// @notice Parent name of the instance for `domain`; reverts for unknown domains.
    function parentNameOf(bytes32 domain) external view returns (string memory) {
        Instance storage i = _instances[domain];
        if (address(i.registry) == address(0)) revert UnknownInstance(domain);
        return i.parentName;
    }

    function isInstance(bytes32 domain) external view returns (bool) {
        return address(_instances[domain].registry) != address(0);
    }
}
