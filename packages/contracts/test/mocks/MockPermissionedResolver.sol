// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IPermissionedResolver, PermissionedResolverRoles as R} from "../../src/interfaces/IPermissionedResolver.sol";

/// @notice Faithful-enough stand-in for the stock ENSv2 PermissionedResolver:
///         root roles, per-(node,key) text/data grants, aliasing, and an ENSIP-10
///         `resolve()` that rewrites the node and staticcalls itself.
contract MockPermissionedResolver is IPermissionedResolver {
    error Unauthorized(address account, uint256 role);
    error UnsupportedResolverProfile(bytes4 selector);

    mapping(address => uint256) public rootRoles;
    mapping(bytes32 => mapping(address => bool)) public partGrants; // keccak(node,key,roleBit) => account
    mapping(bytes32 => bytes) internal _aliases;
    mapping(bytes32 => mapping(string => string)) internal _texts;
    mapping(bytes32 => mapping(string => bytes)) internal _datas;

    constructor(address admin) {
        rootRoles[admin] = type(uint256).max;
    }

    function grantRootRoles(uint256 roleBitmap, address account) external {
        rootRoles[account] |= roleBitmap;
    }

    function _part(bytes32 node, string memory key, uint256 roleBit) internal pure returns (bytes32) {
        return keccak256(abi.encode(node, keccak256(bytes(key)), roleBit));
    }

    function _requireRoot(uint256 roleBit) internal view {
        if (rootRoles[msg.sender] & roleBit != roleBit) revert Unauthorized(msg.sender, roleBit);
    }

    function _requirePart(bytes32 node, string memory key, uint256 roleBit) internal view {
        if (rootRoles[msg.sender] & roleBit == roleBit) return;
        if (!partGrants[_part(node, key, roleBit)][msg.sender]) revert Unauthorized(msg.sender, roleBit);
    }

    function setAlias(bytes calldata fromName, bytes calldata toName) external {
        _requireRoot(R.ROLE_SET_ALIAS);
        _aliases[NameCoder.namehash(fromName, 0)] = toName;
    }

    function getAlias(bytes memory fromName) public view returns (bytes memory) {
        return _aliases[NameCoder.namehash(fromName, 0)];
    }

    function authorizeTextRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool)
    {
        _requireRoot(R.ROLE_SET_TEXT_ADMIN);
        partGrants[_part(NameCoder.namehash(toName, 0), key, R.ROLE_SET_TEXT)][account] = grant;
        return true;
    }

    function authorizeDataRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool)
    {
        _requireRoot(R.ROLE_SET_DATA_ADMIN);
        partGrants[_part(NameCoder.namehash(toName, 0), key, R.ROLE_SET_DATA)][account] = grant;
        return true;
    }

    function hasTextGrant(bytes memory name, string memory key, address account) external view returns (bool) {
        return partGrants[_part(NameCoder.namehash(name, 0), key, R.ROLE_SET_TEXT)][account];
    }

    function multicall(bytes[] calldata calls) public returns (bytes[] memory results) {
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            (bool ok, bytes memory v) = address(this).delegatecall(calls[i]);
            if (!ok) {
                assembly {
                    revert(add(v, 32), mload(v))
                }
            }
            results[i] = v;
        }
    }

    function setText(bytes32 node, string calldata key, string calldata value) external {
        _requirePart(node, key, R.ROLE_SET_TEXT);
        _texts[node][key] = value;
    }

    function setData(bytes32 node, string calldata key, bytes calldata value) external {
        _requirePart(node, key, R.ROLE_SET_DATA);
        _datas[node][key] = value;
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }

    function data(bytes32 node, string calldata key) external view returns (bytes memory) {
        return _datas[node][key];
    }

    function resolve(bytes calldata fromName, bytes calldata fromData) external view returns (bytes memory) {
        bytes memory toName = getAlias(fromName);
        bytes32 node = NameCoder.namehash(toName.length == 0 ? fromName : toName, 0);
        bytes memory toData = fromData;
        assembly {
            mstore(add(toData, 36), node)
        }
        (bool ok, bytes memory v) = address(this).staticcall(toData);
        if (v.length == 0) revert UnsupportedResolverProfile(bytes4(fromData));
        if (!ok) {
            assembly {
                revert(add(v, 32), mload(v))
            }
        }
        return v;
    }
}
