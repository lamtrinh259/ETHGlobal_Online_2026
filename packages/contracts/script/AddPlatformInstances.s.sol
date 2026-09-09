// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";

/**
 * Give each platform domain its own instance under the root registry, so an attested account is a name
 * any ENS client can read: `<handle>.<platform>.<root>`. A masked account's label is the masked bytes,
 * which proves the account exists without publishing which one it is.
 *
 * Idempotent: a domain the factory already knows is skipped.
 *
 *   FACTORY=0x… REGISTRY=0x… PERMISSIONED_RESOLVER=0x… ROOT_PARENT=ketsuban.eth \
 *   PLATFORMS=x,telegram,discord,github,google,linkedin,email PRIVATE_KEY=$OPERATOR_KEY \
 *   forge script script/AddPlatformInstances.s.sol --rpc-url $SEPOLIA_RPC --broadcast
 */
contract AddPlatformInstances is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        AttestationFactory factory = AttestationFactory(vm.envAddress("FACTORY"));
        AttestationRegistry root = AttestationRegistry(vm.envAddress("REGISTRY"));
        IPermissionedResolver inner = IPermissionedResolver(vm.envAddress("PERMISSIONED_RESOLVER"));
        string memory rootParent = vm.envString("ROOT_PARENT");
        string[] memory platforms = vm.split(vm.envString("PLATFORMS"), ",");

        vm.startBroadcast(pk);
        for (uint256 i; i < platforms.length; ++i) {
            string memory label = platforms[i];
            bytes32 domain = bytes32(bytes(label));
            if (factory.isInstance(domain)) {
                console.log("exists", label);
                continue;
            }
            (AttestationRegistry reg, AttestationResolver res) =
                factory.create(domain, IRegistry(address(root)), label, string.concat(label, ".", rootParent), inner);
            root.setSubregistry(label, IRegistry(address(reg)));
            console.log("created", label);
            console.log("  registry", address(reg));
            console.log("  resolver", address(res));
        }
        vm.stopBroadcast();
    }
}
