// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IOwnedRegistry} from "@ensv2/registry/IOwnedRegistry.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AttestationFactory} from "./AttestationFactory.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";
import {LibLabel} from "./libraries/LibLabel.sol";

/// @notice Singleton that acts with resolver admin roles at the moment a user registers or links a
///         name, for every instance the factory knows:
///         - `verify` / `verifyFor`: proxy `Multipass.register` and, when the record's domain is an
///           instance, grant the wallet record-level `ROLE_SET_TEXT` on four profile keys atomically.
///         - `linkOwnName`: `<prefix>.<label>.eth → <handle>.<parentName>` alias, gated on `.eth`
///           ownership read from the ENSv2 registry in the same transaction.
///         - `onReport`: the same registration driven by a Chainlink CRE report, so the enclave that
///           signed the record is also what writes it. The DON cannot attach value, so the domain fee
///           is paid from this contract's own balance, which anyone may top up.
///         Multipass never reads `msg.sender`, so registering through here changes nothing on the
///         Multipass side. Roles held on INNER: `ROLE_SET_TEXT_ADMIN`, `ROLE_SET_ALIAS`.
contract AttestationBridge is Ownable, IReceiver {
    struct Org {
        address treasury;
        bool active;
        LibMultipass.NameQuery referrerQuery;
        bytes referralCode;
    }

    /// @notice KeystoneForwarder for this chain; the only address allowed to deliver reports.
    address public immutable FORWARDER;

    IMultipass public immutable MP;
    IPermissionedResolver public immutable INNER;
    IOwnedRegistry public immutable ETH_REGISTRY;
    AttestationFactory public immutable FACTORY;

    mapping(bytes32 orgId => Org) internal _orgs;

    event Sponsored(bytes32 indexed orgId, bytes32 indexed id, bytes32 domainName);
    event OrgSet(bytes32 indexed orgId, address treasury, bool active);
    event NameLinked(address indexed wallet, bytes32 indexed domain, string label, bytes canonicalName);
    event Reported(bytes32 indexed id, bytes32 indexed domainName, uint256 fee, bytes metadata);
    event Funded(address indexed from, uint256 amount);

    error NotOrgTreasury(bytes32 orgId, address sender);
    error NotNameOwner(string label, address sender);
    error NoRecord(bytes32 domain, address wallet);
    error UnauthorizedForwarder(address caller);
    error FeeNotFunded(uint256 needed, uint256 balance);

    constructor(
        IMultipass mp,
        IPermissionedResolver inner,
        IOwnedRegistry ethRegistry,
        AttestationFactory factory,
        address owner,
        address forwarder
    ) Ownable(owner) {
        FORWARDER = forwarder;
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
     * @notice Register a record from a Chainlink CRE report: the DON writes what its enclave signed,
     *         so no relayer key stands between the attestation and the chain.
     * @param metadata Forwarder-supplied execution metadata; kept in the event for audit.
     * @param report `abi.encode(LibMultipass.Record, bytes registrarSig)`, as the workflow encodes it.
     */
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != FORWARDER) revert UnauthorizedForwarder(msg.sender);
        (LibMultipass.Record memory rec, bytes memory registrarSig) =
            abi.decode(report, (LibMultipass.Record, bytes));
        uint256 fee = MP.getDomainState(rec.domainName).fee;
        if (fee > address(this).balance) revert FeeNotFunded(fee, address(this).balance);
        MP.register{value: fee}(rec, registrarSig, emptyQuery(), "");
        _grantProfileKeysMemory(rec);
        emit Reported(rec.id, rec.domainName, fee, metadata);
    }

    /// @notice Anyone may fund the domain fees the DON cannot attach to a report.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
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

    function emptyQuery() internal pure returns (LibMultipass.NameQuery memory q) {
        return LibMultipass.NameQuery(bytes32(0), address(0), bytes32(0), bytes32(0), bytes32(0));
    }

    function _grantProfileKeys(LibMultipass.Record calldata rec) internal {
        _grantProfileKeysMemory(rec);
    }

    function _grantProfileKeysMemory(LibMultipass.Record memory rec) internal {
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
