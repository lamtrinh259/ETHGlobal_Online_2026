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
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {IPermissionedResolver} from "./interfaces/IPermissionedResolver.sol";
import {LibLabel} from "./libraries/LibLabel.sol";

/// @notice ENSIP-10 shim serving every `*.<parentName>` of one attestation instance.
///         Attestation-backed keys are read from Multipass:
///           addr                         wallet of the live record
///           name (reverse)               `<handle>.<parentName>` for a wallet
///           text  att:answer             record payload as string
///           text  att:expiry             record validUntil
///           text  att:humanity[:until]   wallet-keyed hop into the `humanity` domain
///           data  att:link:<domain>      wallet-keyed hop → abi.encodePacked(name, id, payload)
///         Everything else is forwarded to the stock ENSv2 PermissionedResolver (aliasing,
///         versioning, user text records, oracle data records).
///
///         No `supportsFeature(RESOLVE_MULTICALL)`: the Universal Resolver then issues one call per
///         profile, so the shim never has to unpack multicall batches.
contract AttestationResolver is IExtendedResolver, IERC165 {
    IMultipass public immutable MP;
    IPermissionedResolver public immutable INNER;
    bytes32 public immutable DOMAIN;
    bytes32 public constant HUMANITY = "humanity";
    string internal _parentName;

    bytes32 internal constant KEY_ANSWER = keccak256("att:answer");
    bytes32 internal constant KEY_EXPIRY = keccak256("att:expiry");
    bytes32 internal constant KEY_HUMANITY = keccak256("att:humanity");
    bytes32 internal constant KEY_HUMANITY_UNTIL = keccak256("att:humanity:until");
    bytes internal constant LINK_PREFIX = "att:link:";

    constructor(IMultipass mp, IPermissionedResolver inner, bytes32 domain, string memory parentName) {
        MP = mp;
        INNER = inner;
        DOMAIN = domain;
        _parentName = parentName;
    }

    function parentName() external view returns (string memory) {
        return _parentName;
    }

    /// @inheritdoc IExtendedResolver
    function resolve(bytes calldata fromName, bytes calldata data) external view returns (bytes memory) {
        bytes memory alias_ = INNER.getAlias(fromName);
        bytes memory name = alias_.length == 0 ? fromName : alias_;
        bytes4 sel = bytes4(data[:4]);

        if (sel == INameResolver.name.selector) return _reverse(name);

        bytes32 label = _firstLabel(name);
        if (sel == IAddrResolver.addr.selector) return _addr(label);
        if (sel == ITextResolver.text.selector) {
            (, string memory key) = abi.decode(data[4:], (bytes32, string));
            bytes32 k = keccak256(bytes(key));
            if (k == KEY_ANSWER) return _answer(label);
            if (k == KEY_EXPIRY) return _expiry(label);
            if (k == KEY_HUMANITY) return _humanity(label);
            if (k == KEY_HUMANITY_UNTIL) return _humanityUntil(label);
        } else if (sel == IDataResolver.data.selector) {
            (, string memory key) = abi.decode(data[4:], (bytes32, string));
            (bool isLink, bytes32 domain) = _linkDomain(bytes(key));
            if (isLink) return _link(label, domain);
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

    // ---------- attestation reads ----------

    function _own(bytes32 label) internal view returns (bool live, LibMultipass.Record memory r) {
        bool ok;
        (ok, r) = MP.resolveRecord(LibMultipass.NameQuery(DOMAIN, address(0), label, bytes32(0), bytes32(0)));
        live = ok && r.validUntil > block.timestamp;
    }

    /// @dev Wallet-keyed hop from this instance's record into another domain.
    function _hop(bytes32 label, bytes32 target) internal view returns (bool live, LibMultipass.Record memory r) {
        (bool ownLive, LibMultipass.Record memory me) = _own(label);
        if (!ownLive) return (false, r);
        bool ok;
        (ok, r) = MP.resolveRecord(LibMultipass.NameQuery(DOMAIN, me.wallet, bytes32(0), bytes32(0), target));
        live = ok && r.validUntil > block.timestamp;
    }

    function _addr(bytes32 label) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _own(label);
        return abi.encode(live ? r.wallet : address(0));
    }

    function _answer(bytes32 label) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _own(label);
        return abi.encode(live ? LibLabel.fromBytes32(r.payload) : "");
    }

    function _expiry(bytes32 label) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _own(label);
        return abi.encode(live ? Strings.toString(r.validUntil) : "");
    }

    function _humanity(bytes32 label) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory h) = _hop(label, HUMANITY);
        return abi.encode(live ? LibLabel.fromBytes32(h.payload) : "");
    }

    function _humanityUntil(bytes32 label) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory h) = _hop(label, HUMANITY);
        return abi.encode(live ? Strings.toString(h.validUntil) : "");
    }

    /// @dev `payload != 0` marks an opted-in record whose name/id are XOR-masked with the view code.
    function _link(bytes32 label, bytes32 domain) internal view returns (bytes memory) {
        (bool live, LibMultipass.Record memory r) = _hop(label, domain);
        return abi.encode(live ? abi.encodePacked(r.name, r.id, r.payload) : bytes(""));
    }

    /// @dev `<40 hex>.addr.reverse` → wallet → handle → `<handle>.<parentName>`
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
            MP.resolveRecord(LibMultipass.NameQuery(DOMAIN, wallet, bytes32(0), bytes32(0), bytes32(0)));
        if (!ok || r.validUntil <= block.timestamp) return abi.encode("");
        return abi.encode(string.concat(LibLabel.fromBytes32(r.name), ".", _parentName));
    }

    // ---------- parsing ----------

    function _firstLabel(bytes memory name) internal pure returns (bytes32 label) {
        uint256 size = uint8(name[0]);
        if (size == 0 || size > 31) return bytes32(0);
        bytes memory raw = new bytes(size);
        for (uint256 i; i < size; ++i) {
            raw[i] = name[1 + i];
        }
        (, label) = LibLabel.toBytes32(raw);
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
