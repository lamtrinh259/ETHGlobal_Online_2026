// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IOwnedRegistry} from "@ensv2/registry/IOwnedRegistry.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AttestationFactory} from "./AttestationFactory.sol";
import {RootAttestationResolver} from "./RootAttestationResolver.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {LibLabel} from "./libraries/LibLabel.sol";

/// @notice Singleton that acts with resolver admin roles at the moment a user registers or links a
///         name, for every instance the factory knows:
///         - `verify` / `verifyFor`: proxy `Multipass.register` and, when the record's domain is an
///           instance, grant the wallet record-level `ROLE_SET_TEXT` on four profile keys atomically.
///         - `linkOwnName`: `<prefix>.<label>.eth → <handle>.<parentName>` alias, gated on `.eth`
///           ownership read from the ENSv2 registry in the same transaction.
///         Multipass never reads `msg.sender`, so registering through here changes nothing on the
///         Multipass side. Roles held on INNER: `ROLE_SET_TEXT_ADMIN`, `ROLE_SET_ALIAS`.
contract AttestationBridge is Ownable {
    struct Org {
        address treasury;
        bool active;
        LibMultipass.NameQuery referrerQuery;
        bytes referralCode;
    }

    IMultipass public immutable MP;
    IPermissionedResolver public immutable INNER;
    IOwnedRegistry public immutable ETH_REGISTRY;
    AttestationFactory public immutable FACTORY;

    mapping(bytes32 orgId => Org) internal _orgs;
    /// @notice Where the tree is one resolver at the root, the name a record answers at comes from it
    ///         rather than from the factory, which no longer knows every mount. Zero until migrated.
    RootAttestationResolver public rootResolver;

    event RootResolverSet(address resolver);

    event Sponsored(bytes32 indexed orgId, bytes32 indexed id, bytes32 domainName);
    event OrgSet(bytes32 indexed orgId, address treasury, bool active);
    event NameLinked(address indexed wallet, bytes32 indexed domain, string label, bytes canonicalName);

    error NotOrgTreasury(bytes32 orgId, address sender);
    error NotNameOwner(string label, address sender);
    error NoRecord(bytes32 domain, address wallet);

    constructor(
        IMultipass mp,
        IPermissionedResolver inner,
        IOwnedRegistry ethRegistry,
        AttestationFactory factory,
        address owner
    ) Ownable(owner) {
        MP = mp;
        INNER = inner;
        ETH_REGISTRY = ethRegistry;
        FACTORY = factory;
    }

    /// @notice Registration proxy; anyone may pay for anyone.
    function verify(
        LibMultipass.Record calldata rec,
        bytes calldata registrarSig,
        LibMultipass.NameQuery calldata referrer,
        bytes calldata referralCode
    ) external payable {
        MP.register{value: msg.value}(rec, registrarSig, referrer, referralCode);
        _grantProfileKeys(rec);
    }

    /// @notice Registration with one text record written in the same transaction: the letter behind
    ///         a reference. The bridge borrows the key it grants the wallet, writes, and hands it back,
    ///         so a wallet holding no gas still gets its letter on chain.
    function verifyWithText(
        LibMultipass.Record calldata rec,
        bytes calldata registrarSig,
        LibMultipass.NameQuery calldata referrer,
        bytes calldata referralCode,
        string calldata key,
        string calldata value
    ) external payable {
        MP.register{value: msg.value}(rec, registrarSig, referrer, referralCode);
        bytes memory n = _grantProfileKeys(rec);
        if (n.length == 0 || bytes(value).length == 0) return;
        INNER.authorizeTextRoles(n, key, address(this), true);
        INNER.setText(NameCoder.namehash(n, 0), key, value);
        INNER.authorizeTextRoles(n, key, address(this), false);
    }

    /// @notice Org-sponsored registration: the org's treasury pays and is the Multipass referrer, so
    ///         it earns `referrerReward` back in the same transaction.
    function verifyFor(bytes32 orgId, LibMultipass.Record calldata rec, bytes calldata registrarSig) external payable {
        Org storage o = _orgs[orgId];
        if (!o.active || msg.sender != o.treasury) revert NotOrgTreasury(orgId, msg.sender);
        MP.register{value: msg.value}(rec, registrarSig, o.referrerQuery, o.referralCode);
        _grantProfileKeys(rec);
        emit Sponsored(orgId, rec.id, rec.domainName);
    }

    /// @notice Operator registers or updates a sponsoring org. `referralCode` is the org treasury's
    ///         EIP-712 `proofOfReferrer` signature over its own address.
    function setOrg(
        bytes32 orgId,
        address treasury,
        LibMultipass.NameQuery calldata referrerQuery,
        bytes calldata referralCode,
        bool active
    ) external onlyOwner {
        _orgs[orgId] = Org({
            treasury: treasury, active: active, referrerQuery: referrerQuery, referralCode: referralCode
        });
        emit OrgSet(orgId, treasury, active);
    }

    function org(bytes32 orgId) external view returns (Org memory) {
        return _orgs[orgId];
    }

    /// @notice Bring your own `.eth` name: `<prefix>.<label>.eth` resolves as the caller's record in
    ///         `domain`, where `prefix` is the instance's parent label (e.g. `kju.alice.eth`).
    function linkOwnName(bytes32 domain, string calldata label) external {
        if (ETH_REGISTRY.findOwner(label) != msg.sender) revert NotNameOwner(label, msg.sender);
        (bool ok, LibMultipass.Record memory r) =
            MP.resolveRecord(LibMultipass.NameQuery(domain, msg.sender, bytes32(0), bytes32(0), bytes32(0)));
        if (!ok || r.validUntil <= block.timestamp) revert NoRecord(domain, msg.sender);
        AttestationFactory.Instance memory inst = FACTORY.instance(domain);
        if (address(inst.registry) == address(0)) revert AttestationFactory.UnknownInstance(domain);
        bytes memory canonical = NameCoder.encode(string.concat(LibLabel.fromBytes32(r.name), ".", inst.parentName));
        INNER.setAlias(NameCoder.encode(string.concat(inst.parentLabel, ".", label, ".eth")), canonical);
        emit NameLinked(msg.sender, domain, label, canonical);
    }

    /// @notice Point the bridge at the root resolver, once the deployment has one.
    function setRootResolver(RootAttestationResolver resolver) external onlyOwner {
        rootResolver = resolver;
        emit RootResolverSet(address(resolver));
    }

    /// @dev The parent name a record's domain hangs under: the factory's answer where it has one, the
    ///      root resolver's where the tree lives there, nothing otherwise.
    function _parentNameOf(bytes32 domain) internal view returns (string memory) {
        if (FACTORY.isInstance(domain)) return FACTORY.parentNameOf(domain);
        if (address(rootResolver) != address(0)) return rootResolver.parentNameOf(domain);
        return "";
    }

    /// @dev Returns the DNS-encoded name the keys were granted on, or nothing where there was none.
    function _grantProfileKeys(LibMultipass.Record calldata rec) internal returns (bytes memory n) {
        // A masked record has no readable name to grant on; a humanity proof has no name at all.
        if (rec.name == bytes32(0)) return n;
        string memory parent = _parentNameOf(rec.domainName);
        if (bytes(parent).length == 0) return n;
        n = NameCoder.encode(string.concat(LibLabel.fromBytes32(rec.name), ".", parent));
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(INNER.authorizeTextRoles, (n, "avatar", rec.wallet, true));
        calls[1] = abi.encodeCall(INNER.authorizeTextRoles, (n, "description", rec.wallet, true));
        calls[2] = abi.encodeCall(INNER.authorizeTextRoles, (n, "url", rec.wallet, true));
        calls[3] = abi.encodeCall(INNER.authorizeTextRoles, (n, "email", rec.wallet, true));
        INNER.multicall(calls);
    }
}
