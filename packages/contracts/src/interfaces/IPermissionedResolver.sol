// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

/// @notice The subset of ENSv2 `PermissionedResolver` the attestation contracts call.
///         Signatures mirror ensdomains/contracts-v2 `src/resolver/PermissionedResolver.sol`.
interface IPermissionedResolver {
    function setAlias(bytes calldata fromName, bytes calldata toName) external;
    function getAlias(bytes memory fromName) external view returns (bytes memory toName);
    function authorizeTextRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool);
    function authorizeDataRoles(bytes calldata toName, string calldata key, address account, bool grant)
        external
        returns (bool);
    function multicall(bytes[] calldata calls) external returns (bytes[] memory results);
    function resolve(bytes calldata fromName, bytes calldata fromData) external view returns (bytes memory);
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function setData(bytes32 node, string calldata key, bytes calldata value) external;
    function text(bytes32 node, string calldata key) external view returns (string memory);
    function data(bytes32 node, string calldata key) external view returns (bytes memory);
}

/// @dev Role bits from `PermissionedResolverLib` needed at deploy time.
library PermissionedResolverRoles {
    uint256 internal constant ROLE_SET_ADDR = 1 << 0;
    uint256 internal constant ROLE_SET_TEXT = 1 << 4;
    uint256 internal constant ROLE_SET_TEXT_ADMIN = ROLE_SET_TEXT << 128;
    uint256 internal constant ROLE_SET_ALIAS = 1 << 28;
    uint256 internal constant ROLE_SET_DATA = 1 << 36;
    uint256 internal constant ROLE_SET_DATA_ADMIN = ROLE_SET_DATA << 128;
}
