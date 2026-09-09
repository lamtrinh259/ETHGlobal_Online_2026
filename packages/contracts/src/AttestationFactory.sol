// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {AttestationRegistry} from "./AttestationRegistry.sol";
import {MaskedMirrorRegistry} from "./MaskedMirrorRegistry.sol";
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

    struct Mirror {
        MaskedMirrorRegistry registry;
        AttestationResolver resolver;
        IRegistry parent;
        string parentLabel;
        string parentName;
    }

    IMultipass public immutable MP;
    mapping(bytes32 domain => Instance) internal _instances;
    mapping(bytes32 domain => Mirror) internal _mirrors;
    bytes32[] internal _domains;

    event InstanceCreated(
        bytes32 indexed domain,
        address registry,
        address resolver,
        address parent,
        string parentLabel,
        string parentName
    );

    event MirrorCreated(
        bytes32 indexed domain,
        address registry,
        address resolver,
        address parent,
        string parentLabel,
        string parentName
    );

    error InstanceExists(bytes32 domain);
    error MirrorExists(bytes32 domain);
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
    ) external returns (AttestationRegistry registry, AttestationResolver resolver) {
        return create(domain, parent, parentLabel, parentName, inner, AttestationRegistry.Visibility.Any);
    }

    /// @notice Same, restricted to records of one visibility. A platform's public branch under `www`
    ///         must not answer for an account someone chose to keep behind a view code, even though
    ///         both live in the same Multipass domain.
    function create(
        bytes32 domain,
        IRegistry parent,
        string calldata parentLabel,
        string calldata parentName,
        IPermissionedResolver inner,
        AttestationRegistry.Visibility visibility
    ) public onlyOwner returns (AttestationRegistry registry, AttestationResolver resolver) {
        if (address(_instances[domain].registry) != address(0)) revert InstanceExists(domain);
        resolver = new AttestationResolver(MP, inner, domain, parentName);
        registry = new AttestationRegistry(MP, domain, address(resolver), parent, parentLabel, owner(), visibility);
        _instances[domain] = Instance(registry, resolver, parent, parentLabel, parentName);
        _domains.push(domain);
        emit InstanceCreated(domain, address(registry), address(resolver), address(parent), parentLabel, parentName);
    }

    /// @notice The private half of a platform's namespace. An account kept behind a view code cannot be
    ///         named by its own handle — the masked name is a one-time pad over it — so it is named by
    ///         the person: `alice.com.x.private-www.<root>` says the holder of `alice.<root>` has an
    ///         account on X and stops there. `nameDomain` is the root instance the label is read from.
    function createMirror(
        bytes32 domain,
        bytes32 nameDomain,
        IRegistry parent,
        string calldata parentLabel,
        string calldata parentName,
        IPermissionedResolver inner
    ) external onlyOwner returns (MaskedMirrorRegistry registry, AttestationResolver resolver) {
        if (address(_instances[domain].registry) == address(0)) revert UnknownInstance(domain);
        if (address(_mirrors[domain].registry) != address(0)) revert MirrorExists(domain);
        // Reads the name domain, because the label it answers is the person's name, not the account's.
        resolver = new AttestationResolver(MP, inner, nameDomain, parentName);
        registry = new MaskedMirrorRegistry(MP, nameDomain, domain, address(resolver), parent, parentLabel, owner());
        _mirrors[domain] = Mirror(registry, resolver, parent, parentLabel, parentName);
        emit MirrorCreated(domain, address(registry), address(resolver), address(parent), parentLabel, parentName);
    }

    /// @notice The masked mount for `domain`, or a zeroed struct when the deployment has none.
    function mirror(bytes32 domain) external view returns (Mirror memory) {
        return _mirrors[domain];
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
