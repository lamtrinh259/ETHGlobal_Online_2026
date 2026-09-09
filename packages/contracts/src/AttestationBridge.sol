// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IOwnedRegistry} from "@ensv2/registry/IOwnedRegistry.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AttestationFactory} from "./AttestationFactory.sol";
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

    /**
     * @notice Register a record, or renew it when one already exists for this `(domainName, id)`.
     *         Multipass splits those into two entry points and `register` reverts with `recordExists`
     *         on the second write, so a caller holding a freshly signed record cannot use one path
     *         for both. Routing here keeps every writer — browser relay and DON report alike — on a
     *         single call, and re-grants the profile keys, which is idempotent.
     */
    function submitRecord(LibMultipass.Record calldata rec, bytes calldata registrarSig) external payable {
        LibMultipass.NameQuery memory query = LibMultipass.NameQuery({
            domainName: rec.domainName,
            wallet: address(0),
            name: bytes32(0),
            id: rec.id,
            targetDomain: bytes32(0)
        });
        (bool exists,) = MP.resolveRecord(query);
        if (exists) {
            MP.renewRecord{value: msg.value}(query, rec, registrarSig);
        } else {
            MP.register{value: msg.value}(rec, registrarSig, emptyQuery(), "");
        }
        _grantProfileKeys(rec);
    }

    /// @notice The fee `submitRecord` needs for this record: the domain's registration or renewal fee.
    function feeFor(LibMultipass.Record calldata rec) external view returns (uint256) {
        LibMultipass.NameQuery memory query = LibMultipass.NameQuery({
            domainName: rec.domainName,
            wallet: address(0),
            name: bytes32(0),
            id: rec.id,
            targetDomain: bytes32(0)
        });
        (bool exists,) = MP.resolveRecord(query);
        LibMultipass.Domain memory d = MP.getDomainState(rec.domainName);
        return exists ? d.renewalFee : d.fee;
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

    function emptyQuery() internal pure returns (LibMultipass.NameQuery memory) {
        return LibMultipass.NameQuery(bytes32(0), address(0), bytes32(0), bytes32(0), bytes32(0));
    }

    function _grantProfileKeys(LibMultipass.Record calldata rec) internal {
        if (!FACTORY.isInstance(rec.domainName)) return;
        bytes memory n =
            NameCoder.encode(string.concat(LibLabel.fromBytes32(rec.name), ".", FACTORY.parentNameOf(rec.domainName)));
        bytes[] memory calls = new bytes[](4);
        calls[0] = abi.encodeCall(INNER.authorizeTextRoles, (n, "avatar", rec.wallet, true));
        calls[1] = abi.encodeCall(INNER.authorizeTextRoles, (n, "description", rec.wallet, true));
        calls[2] = abi.encodeCall(INNER.authorizeTextRoles, (n, "url", rec.wallet, true));
        calls[3] = abi.encodeCall(INNER.authorizeTextRoles, (n, "email", rec.wallet, true));
        INNER.multicall(calls);
    }
}
