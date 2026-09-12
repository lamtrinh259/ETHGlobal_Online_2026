// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IExtendedResolver} from "@ens/contracts/resolvers/profiles/IExtendedResolver.sol";
import {IAddrResolver} from "@ens/contracts/resolvers/profiles/IAddrResolver.sol";
import {ITextResolver} from "@ens/contracts/resolvers/profiles/ITextResolver.sol";
import {IDataResolver} from "@ens/contracts/resolvers/profiles/IDataResolver.sol";
import {INameResolver} from "@ens/contracts/resolvers/profiles/INameResolver.sol";
import {HexUtils} from "@ens/contracts/utils/HexUtils.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {LibLabel} from "./libraries/LibLabel.sol";

/// @notice One ENSIP-10 resolver for the whole tree under a root name, reading Multipass.
///
///         Today every platform, subject and candidate has a registry and a resolver of its own, deployed
///         once per mount, because the Universal Resolver hands a name to the nearest ancestor resolver
///         and a root resolver that did not know the tree answered `alice.<anything>.<root>` as alice.
///         This one knows the tree — from Multipass, which is where every domain already is — so nothing
///         needs deploying to add a platform, and a label that is not a domain answers nothing.
///
///         The name minus the root is `<label>.<path>`, and the path names the domain:
///           (none)                       the root name domain: `alice.<root>`
///           <subject>                    a name domain Multipass holds: `alice.kju-is.<root>`
///           <candidate>                  the candidate's vouch domain `~candidate`: `bob.alice.<root>`
///           <dns reversed>.<grouping>     a platform under `www`, a mail host under the at-sign level:
///                                        `alice_x.com.x.www.<root>` reads from `x.com`
///           <dns reversed>.<private-*>   the same, masked: the label is the person's root name, and the
///                                        answer says only that they hold a masked record there
///         Everything the per-instance resolver answers is answered here the same way; every other
///         key is forwarded to the stock PermissionedResolver, where a name's own records live.
contract RootAttestationResolver is IExtendedResolver, IERC165 {
    IMultipass public immutable MP;
    IPermissionedResolver public immutable INNER;
    /// @notice The domain people hold their names in: what a bare `<label>.<root>` means.
    bytes32 public immutable ROOT_DOMAIN;
    bytes32 public immutable ROOT_HASH;
    bytes32 public constant HUMANITY = "humanity";
    /// @notice Prefix of a candidate's vouch domain: `~alice` holds the references written for alice.
    bytes1 public constant VOUCH_PREFIX = "~";
    string internal _rootName;

    bytes32 internal constant KEY_ANSWER = keccak256("ketsuban:answer");
    bytes32 internal constant KEY_EXPIRY = keccak256("ketsuban:expiry");
    bytes32 internal constant KEY_HUMANITY = keccak256("ketsuban:humanity");
    bytes32 internal constant KEY_HUMANITY_UNTIL = keccak256("ketsuban:humanity:until");
    bytes internal constant LINK_PREFIX = "ketsuban:link:";

    /// @dev Where a name landed: which Multipass domain answers, which label in it, and whether it is
    ///      the masked branch, where the label is the person and the domain is checked by wallet.
    struct Where {
        bool known;
        bytes32 domain;
        bytes32 label;
        bool masked;
    }

    constructor(IMultipass mp, IPermissionedResolver inner, bytes32 rootDomain, string memory rootName) {
        MP = mp;
        INNER = inner;
        ROOT_DOMAIN = rootDomain;
        _rootName = rootName;
        ROOT_HASH = keccak256(NameCoder.encode(rootName));
    }

    function rootName() external view returns (string memory) {
        return _rootName;
    }

    /// @inheritdoc IExtendedResolver
    function resolve(bytes calldata fromName, bytes calldata data) external view returns (bytes memory) {
        bytes memory alias_ = INNER.getAlias(fromName);
        bytes memory name = alias_.length == 0 ? fromName : alias_;
        bytes4 sel = bytes4(data[:4]);

        if (sel == INameResolver.name.selector) return _reverse(name);

        Where memory at = locate(name);
        if (sel == IAddrResolver.addr.selector) return _addr(at);
        if (sel == ITextResolver.text.selector) {
            (, string memory key) = abi.decode(data[4:], (bytes32, string));
            bytes32 k = keccak256(bytes(key));
            if (k == KEY_ANSWER) return _answer(at);
            if (k == KEY_EXPIRY) return _expiry(at);
            if (k == KEY_HUMANITY) return _humanity(at);
            if (k == KEY_HUMANITY_UNTIL) return _humanityUntil(at);
        } else if (sel == IDataResolver.data.selector) {
            (, string memory key) = abi.decode(data[4:], (bytes32, string));
            (bool isLink, bytes32 domain) = _linkDomain(bytes(key));
            if (isLink) return _link(at, domain);
        }

        (bool ok, bytes memory v) =
            address(INNER).staticcall(abi.encodeWithSelector(IExtendedResolver.resolve.selector, fromName, data));
        if (!ok) {
            assembly {
                revert(add(v, 32), mload(v))
            }
        }
        return abi.decode(v, (bytes));
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == type(IExtendedResolver).interfaceId || id == type(IERC165).interfaceId;
    }

    // ---------- where a name lands ----------

    /// @notice Which Multipass domain a DNS-encoded name under the root is read from, and which label.
    ///         `known` is false for a name the tree does not have: nothing answers for it, which is the
    ///         whole reason this resolver exists.
    function locate(bytes memory name) public view returns (Where memory at) {
        (bool underRoot, bytes32[] memory labels) = _labelsUnderRoot(name);
        if (!underRoot || labels.length == 0) return at;
        at.label = labels[0];
        uint256 depth = labels.length - 1;

        if (depth == 0) return _found(at, ROOT_DOMAIN);
        if (depth == 1) {
            // A subject, or a candidate: whichever domain Multipass holds. A name domain wins over a
            // vouch domain of the same label only if it exists, and a candidate's label never is one.
            if (_isDomain(labels[1])) return _found(at, labels[1]);
            bytes32 vouch = _vouchDomain(labels[1]);
            if (vouch != bytes32(0) && _isDomain(vouch)) return _found(at, vouch);
            return at;
        }
        // A platform or a mail host: the last label is the grouping, the rest is the DNS name reversed.
        (bool open, bool masked) = _grouping(labels[depth]);
        if (!open && !masked) return at;
        bytes32 domain = _dnsDomain(labels, 1, depth);
        if (domain == bytes32(0) || !_isDomain(domain)) return at;
        at.masked = masked;
        return _found(at, domain);
    }

    function _found(Where memory at, bytes32 domain) internal pure returns (Where memory) {
        at.known = true;
        at.domain = domain;
        return at;
    }

    function _isDomain(bytes32 domain) internal view returns (bool) {
        LibMultipass.Domain memory d = MP.getDomainState(domain);
        return d.name == domain && d.isActive;
    }

    /// @dev `alice` → `~alice`, or nothing where the prefix does not fit.
    function _vouchDomain(bytes32 label) internal pure returns (bytes32) {
        bytes memory raw = bytes(LibLabel.fromBytes32(label));
        if (raw.length == 0 || raw.length > 30) return bytes32(0);
        (, bytes32 out) = LibLabel.toBytes32(abi.encodePacked(VOUCH_PREFIX, raw));
        return out;
    }

    function _grouping(bytes32 label) internal pure returns (bool open, bool masked) {
        if (label == bytes32("www") || label == bytes32("@")) return (true, false);
        if (label == bytes32("private-www") || label == bytes32("private@")) return (false, true);
        return (false, false);
    }

    /// @dev `["alice", "com", "x", "www"]` from 1 to 3 → `x.com`: the walk read backwards, dotted.
    function _dnsDomain(bytes32[] memory labels, uint256 from, uint256 to) internal pure returns (bytes32) {
        bytes memory dns;
        for (uint256 i = to; i > from; --i) {
            bytes memory part = bytes(LibLabel.fromBytes32(labels[i - 1]));
            dns = dns.length == 0 ? part : abi.encodePacked(dns, ".", part);
        }
        if (dns.length == 0 || dns.length > 31) return bytes32(0);
        (, bytes32 out) = LibLabel.toBytes32(dns);
        return out;
    }

    /// @dev The labels of `name` above the root, first label first; `underRoot` false where the name
    ///      does not end in the root at all.
    function _labelsUnderRoot(bytes memory name) internal view returns (bool underRoot, bytes32[] memory labels) {
        uint256 count;
        uint256 offset;
        // First pass: find where the root begins, counting labels above it.
        while (offset < name.length) {
            uint256 size = uint8(name[offset]);
            if (size == 0) return (false, labels);
            bytes memory rest = new bytes(name.length - offset);
            for (uint256 i; i < rest.length; ++i) {
                rest[i] = name[offset + i];
            }
            if (keccak256(rest) == ROOT_HASH) {
                underRoot = true;
                break;
            }
            ++count;
            offset += 1 + size;
        }
        if (!underRoot) return (false, labels);
        labels = new bytes32[](count);
        offset = 0;
        for (uint256 n; n < count; ++n) {
            uint256 size = uint8(name[offset]);
            bytes memory raw = new bytes(size);
            for (uint256 i; i < size; ++i) {
                raw[i] = name[offset + 1 + i];
            }
            (bool fits, bytes32 label) = LibLabel.toBytes32(raw);
            labels[n] = fits ? label : bytes32(0);
            offset += 1 + size;
        }
    }

    // ---------- attestation reads ----------

    /// @dev The record a name is about: in the open, the label's own record in the domain; in the masked
    ///      branch, the person's root record, and only if their wallet holds a live masked record there.
    function _own(Where memory at) internal view returns (bool live, LibMultipass.Record memory r) {
        if (!at.known) return (false, r);
        bool ok;
        if (!at.masked) {
            (ok, r) = MP.resolveRecord(LibMultipass.NameQuery(at.domain, address(0), at.label, bytes32(0), bytes32(0)));
            live = ok && r.validUntil > block.timestamp;
            return (live, r);
        }
        (ok, r) = MP.resolveRecord(LibMultipass.NameQuery(ROOT_DOMAIN, address(0), at.label, bytes32(0), bytes32(0)));
        if (!ok || r.validUntil <= block.timestamp) return (false, r);
        (bool held, LibMultipass.Record memory m) =
            MP.resolveRecord(LibMultipass.NameQuery(ROOT_DOMAIN, r.wallet, bytes32(0), bytes32(0), at.domain));
        // A masked record carries a commitment where a public one carries nothing.
        live = held && m.validUntil > block.timestamp && m.payload != bytes32(0);
    }

    /// @dev Wallet-keyed hop from the name's record into another domain.
    function _hop(Where memory at, bytes32 target) internal view returns (bool live, LibMultipass.Record memory r) {
        (bool ownLive, LibMultipass.Record memory me) = _own(at);
        if (!ownLive) return (false, r);
        bool ok;
        (ok, r) = MP.resolveRecord(LibMultipass.NameQuery(at.domain, me.wallet, bytes32(0), bytes32(0), target));
        live = ok && r.validUntil > block.timestamp;
    }

    function _addr(Where memory at) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _own(at);
        return abi.encode(live ? r.wallet : address(0));
    }

    function _answer(Where memory at) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _own(at);
        return abi.encode(live && !at.masked ? LibLabel.fromBytes32(r.payload) : "");
    }

    function _expiry(Where memory at) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _own(at);
        return abi.encode(live ? Strings.toString(r.validUntil) : "");
    }

    function _humanity(Where memory at) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory h) = _hop(at, HUMANITY);
        return abi.encode(live ? LibLabel.fromBytes32(h.payload) : "");
    }

    function _humanityUntil(Where memory at) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory h) = _hop(at, HUMANITY);
        return abi.encode(live ? Strings.toString(h.validUntil) : "");
    }

    function _link(Where memory at, bytes32 domain) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _hop(at, domain);
        return abi.encode(live ? abi.encodePacked(r.name, r.id, r.payload) : bytes(""));
    }

    /// @dev `<40 hex>.addr.reverse` → wallet → its root name.
    function _reverse(bytes memory name) internal view returns (bytes memory) {
        uint256 size = uint8(name[0]);
        if (size != 40) return abi.encode("");
        bytes memory hexLabel = new bytes(size);
        for (uint256 i; i < size; ++i) {
            hexLabel[i] = name[1 + i];
        }
        (address wallet, bool valid) = HexUtils.hexToAddress(hexLabel, 0, size);
        if (!valid) return abi.encode("");
        (bool ok, LibMultipass.Record memory r) =
            MP.resolveRecord(LibMultipass.NameQuery(ROOT_DOMAIN, wallet, bytes32(0), bytes32(0), bytes32(0)));
        if (!ok || r.validUntil <= block.timestamp) return abi.encode("");
        return abi.encode(string.concat(LibLabel.fromBytes32(r.name), ".", _rootName));
    }

    function _linkDomain(bytes memory key) internal pure returns (bool, bytes32) {
        uint256 p = LINK_PREFIX.length;
        if (key.length <= p || key.length - p > 31) return (false, bytes32(0));
        for (uint256 i; i < p; ++i) {
            if (key[i] != LINK_PREFIX[i]) return (false, bytes32(0));
        }
        bytes memory domain = new bytes(key.length - p);
        for (uint256 i; i < domain.length; ++i) {
            domain[i] = key[p + i];
        }
        return LibLabel.toBytes32(domain);
    }
}
