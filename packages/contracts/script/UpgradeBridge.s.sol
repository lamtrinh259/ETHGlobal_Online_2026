// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {IOwnedRegistry} from "@ensv2/registry/IOwnedRegistry.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {IPermissionedResolver, PermissionedResolverRoles as R} from "../src/interfaces/IPermissionedResolver.sol";

interface IPermissionedResolverRoles {
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
    function revokeRootRoles(uint256 roleBitmap, address account) external returns (bool);
}

/**
 * Replace the bridge with one that accepts Chainlink CRE reports, keeping every other address.
 * The bridge holds only resolver roles, so moving those is the whole migration: Multipass does not
 * know about it, and the factory, registries and resolvers are untouched.
 *
 *   forge script script/UpgradeBridge.s.sol --rpc-url $SEPOLIA_RPC --broadcast --verify
 *
 * Env: MULTIPASS, PERMISSIONED_RESOLVER, ETH_REGISTRY, FACTORY, CRE_FORWARDER, OLD_BRIDGE (optional,
 * revoked when set), PRIVATE_KEY (the resolver's root-role admin).
 */
contract UpgradeBridge is Script {
    uint256 internal constant ROLES = R.ROLE_SET_TEXT_ADMIN | R.ROLE_SET_ALIAS;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address operator = vm.addr(pk);
        address forwarder = vm.envAddress("CRE_FORWARDER");
        IPermissionedResolver inner = IPermissionedResolver(vm.envAddress("PERMISSIONED_RESOLVER"));

        vm.startBroadcast(pk);
        AttestationBridge bridge = new AttestationBridge(
            IMultipass(vm.envAddress("MULTIPASS")),
            inner,
            IOwnedRegistry(vm.envAddress("ETH_REGISTRY")),
            AttestationFactory(vm.envAddress("FACTORY")),
            operator,
            forwarder
        );
        IPermissionedResolverRoles(address(inner)).grantRootRoles(ROLES, address(bridge));
        address old = vm.envOr("OLD_BRIDGE", address(0));
        if (old != address(0)) {
            IPermissionedResolverRoles(address(inner)).revokeRootRoles(ROLES, old);
        }
        vm.stopBroadcast();

        console.log("bridge", address(bridge));
        console.log("forwarder", forwarder);
        console.log("revoked old bridge", old);
    }
}
