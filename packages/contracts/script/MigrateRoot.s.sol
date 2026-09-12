// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {Multipass} from "@peeramid-labs/multipass/src/Multipass.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {RootAttestationResolver} from "../src/RootAttestationResolver.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";

interface IEthRegistryAdmin {
    function setResolver(uint256 tokenId, address resolver) external;
    function getResolver(string calldata label) external view returns (address);
}

/**
 * Migrate a deployment to one wildcard resolver at the root, one reversible step at a time.
 *
 * ENSv2 resolves by walking registries: a level with a subregistry keeps its own resolver, a level
 * without falls back to the nearest ancestor's. So the old tree and the new resolver coexist, and the
 * switch happens per level, with `check:live` between steps and one transaction to undo any of them.
 *
 *   STEP=deploy   deploys RootAttestationResolver and prints its address (put it in the deployment
 *                 file as `rootResolver`, or in the API's env as ROOT_RESOLVER)
 *   STEP=bridge   BRIDGE=0x… ROOT_RESOLVER=0x…: the bridge grants a new name its text records by asking
 *                 the root resolver where the factory has no answer
 *   STEP=point    ETHRegistry.setResolver(<root label>, ROOT_RESOLVER): every level with no registry
 *                 of its own now resolves through the new resolver
 *   STEP=unmount  LABELS=<comma list: www, the at-sign level, private-www, its private twin, kju-is, alice, …>
 *                 root.setSubregistry(label, 0) for each, so those levels resolve through the root too
 *   STEP=remount  LABEL=www REGISTRY=0x… : the rollback of one unmount
 *   STEP=unpoint  RESOLVER=0x… : the rollback of `point`, back to the previous root resolver
 *
 *   ETH_REGISTRY=0x… ROOT_LABEL=ketsuban ROOT_DOMAIN=ketsuban ROOT_PARENT=ketsuban.eth REGISTRY=0x… \
 *   MULTIPASS=0x… PERMISSIONED_RESOLVER=0x… [ROOT_RESOLVER=0x…] PRIVATE_KEY=$OPERATOR_KEY \
 *   STEP=… forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
 */
contract MigrateRoot is Script {
    function run() external {
        string memory step = vm.envString("STEP");
        bytes32 which = keccak256(bytes(step));
        uint256 pk = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(pk);
        if (which == keccak256("deploy")) _deploy(vm.addr(pk));
        else if (which == keccak256("bridge")) _bridge(vm.envAddress("BRIDGE"), vm.envAddress("ROOT_RESOLVER"));
        else if (which == keccak256("point")) _point(vm.envAddress("ROOT_RESOLVER"));
        else if (which == keccak256("unpoint")) _point(vm.envAddress("RESOLVER"));
        else if (which == keccak256("unmount")) _unmount(vm.envString("LABELS"));
        else if (which == keccak256("remount")) _remount(vm.envString("LABEL"), vm.envAddress("REGISTRY_TO_MOUNT"));
        else revert("STEP must be deploy, bridge, point, unpoint, unmount or remount");
        vm.stopBroadcast();
    }

    function _deploy(address owner) internal {
        RootAttestationResolver root = new RootAttestationResolver(
            Multipass(payable(vm.envAddress("MULTIPASS"))),
            IPermissionedResolver(vm.envAddress("PERMISSIONED_RESOLVER")),
            bytes32(bytes(vm.envString("ROOT_DOMAIN"))),
            vm.envString("ROOT_PARENT"),
            owner
        );
        console.log("rootResolver", address(root));
    }

    function _bridge(address bridge, address resolver) internal {
        AttestationBridge(bridge).setRootResolver(RootAttestationResolver(resolver));
        console.log("bridge asks", resolver);
    }

    function _point(address resolver) internal {
        IEthRegistryAdmin eth = IEthRegistryAdmin(vm.envAddress("ETH_REGISTRY"));
        string memory label = vm.envString("ROOT_LABEL");
        // ENSv2 addresses a name by token id: the labelhash with the version bits cleared.
        eth.setResolver(uint256(keccak256(bytes(label))) & ~uint256(type(uint32).max), resolver);
        console.log("now serving", label, eth.getResolver(label));
    }

    function _unmount(string memory labels) internal {
        AttestationRegistry root = AttestationRegistry(vm.envAddress("REGISTRY"));
        string[] memory list = _split(labels);
        for (uint256 i; i < list.length; ++i) {
            address before = address(root.getSubregistry(list[i]));
            root.setSubregistry(list[i], IRegistry(address(0)));
            // Printed so the rollback has what it needs: the registry that was mounted there.
            console.log("unmounted", list[i], before);
        }
    }

    function _remount(string memory label, address registry) internal {
        AttestationRegistry root = AttestationRegistry(vm.envAddress("REGISTRY"));
        root.setSubregistry(label, IRegistry(registry));
        console.log("remounted", label, registry);
    }

    function _split(string memory csv) internal pure returns (string[] memory out) {
        bytes memory b = bytes(csv);
        uint256 n = 1;
        for (uint256 i; i < b.length; ++i) {
            if (b[i] == ",") ++n;
        }
        out = new string[](n);
        uint256 start;
        uint256 k;
        for (uint256 i; i <= b.length; ++i) {
            if (i == b.length || b[i] == ",") {
                bytes memory part = new bytes(i - start);
                for (uint256 j; j < part.length; ++j) {
                    part[j] = b[start + j];
                }
                out[k++] = string(part);
                start = i + 1;
            }
        }
    }
}
