// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IAddrResolver} from "@ens/contracts/resolvers/profiles/IAddrResolver.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationReporter} from "../src/AttestationReporter.sol";
import {GroupingRegistry} from "../src/GroupingRegistry.sol";
import {RootAttestationResolver} from "../src/RootAttestationResolver.sol";
import {MigrateRoot} from "../script/MigrateRoot.s.sol";
import {BaseTest} from "./Base.t.sol";

/// @dev The migration, step by step, against the local stack: each step is one owner call, each has
///      its rollback, and the tree keeps answering between them.
contract MigrateRootTest is BaseTest {
    MigrateRoot internal script;
    uint256 internal operatorKey = 0x0EE0;

    function setUp() public override {
        super.setUp();
        script = new MigrateRoot();
        // The script broadcasts as the operator: the registry owner, and the deployer of the resolver.
        // BaseTest owns the root registry and the ETH registry label as `operator`.
        vm.setEnv("PRIVATE_KEY", vm.toString(operatorKey));
        vm.setEnv("ETH_REGISTRY", vm.toString(address(ethRegistry)));
        vm.setEnv("MULTIPASS", vm.toString(address(mp)));
        vm.setEnv("PERMISSIONED_RESOLVER", vm.toString(address(inner)));
        vm.setEnv("REGISTRY", vm.toString(address(registry)));
        vm.setEnv("ROOT_LABEL", LABEL);
        vm.setEnv("ROOT_DOMAIN", LABEL);
        vm.setEnv("ROOT_PARENT", PARENT);
        // The registry's owner is whoever BaseTest made it; hand it to the script's key.
        vm.prank(registry.owner());
        registry.transferOwnership(vm.addr(operatorKey));
    }

    function test_deploy_point_unmount_remount_unpoint() public {
        registerName(alice, "alice", "terrible dictator");
        address before = ethRegistry.getResolver(LABEL);
        assertEq(before, address(shim));

        // deploy: a root resolver that reads the same Multipass
        RootAttestationResolver root = new RootAttestationResolver(mp, inner, INSTANCE, PARENT, vm.addr(operatorKey));

        // bridge: a new bridge that asks the root resolver where a name lives, and a reporter in front
        vm.setEnv("STEP", "bridge");
        vm.setEnv("FACTORY", vm.toString(address(factory)));
        vm.setEnv("CRE_FORWARDER", vm.toString(makeAddr("forwarder")));
        vm.setEnv("ROOT_RESOLVER", vm.toString(address(root)));
        uint64 nonce = vm.getNonce(vm.addr(operatorKey));
        script.run();
        AttestationBridge fresh = AttestationBridge(payable(vm.computeCreateAddress(vm.addr(operatorKey), nonce)));
        assertEq(address(fresh.rootResolver()), address(root));
        assertEq(address(fresh.FACTORY()), address(factory));
        AttestationReporter reporter =
            AttestationReporter(payable(vm.computeCreateAddress(vm.addr(operatorKey), nonce + 1)));
        assertEq(address(reporter.BRIDGE()), address(fresh));
        assertEq(reporter.FORWARDER(), makeAddr("forwarder"));

        // point: the root label now resolves through it
        vm.setEnv("STEP", "point");
        vm.setEnv("ROOT_RESOLVER", vm.toString(address(root)));
        script.run();
        assertEq(ethRegistry.getResolver(LABEL), address(root));
        bytes memory out =
            root.resolve(dns("alice.acme-alumni.eth"), abi.encodeWithSelector(IAddrResolver.addr.selector, bytes32(0)));
        assertEq(abi.decode(out, (address)), alice);

        // unmount: a mounted level comes off the root registry, and can go back
        vm.prank(vm.addr(operatorKey));
        GroupingRegistry www = new GroupingRegistry(IRegistry(address(registry)), "www", vm.addr(operatorKey));
        vm.prank(vm.addr(operatorKey));
        registry.setSubregistry("www", IRegistry(address(www)));
        assertEq(address(registry.getSubregistry("www")), address(www));
        vm.setEnv("STEP", "unmount");
        vm.setEnv("LABELS", "www");
        script.run();
        assertEq(address(registry.getSubregistry("www")), address(0));
        vm.setEnv("STEP", "remount");
        vm.setEnv("LABEL", "www");
        vm.setEnv("REGISTRY_TO_MOUNT", vm.toString(address(www)));
        script.run();
        assertEq(address(registry.getSubregistry("www")), address(www));

        // unpoint: back to the resolver that was there
        vm.setEnv("STEP", "unpoint");
        vm.setEnv("RESOLVER", vm.toString(before));
        script.run();
        assertEq(ethRegistry.getResolver(LABEL), before);
    }

    function test_bridge_leavesTheGrantToTheResolverAdmin_whenAsked() public {
        RootAttestationResolver root = new RootAttestationResolver(mp, inner, INSTANCE, PARENT, vm.addr(operatorKey));
        vm.setEnv("STEP", "bridge");
        vm.setEnv("FACTORY", vm.toString(address(factory)));
        vm.setEnv("ROOT_RESOLVER", vm.toString(address(root)));
        vm.setEnv("GRANT_ROLES", "0");
        uint64 nonce = vm.getNonce(vm.addr(operatorKey));
        script.run();
        AttestationBridge fresh = AttestationBridge(payable(vm.computeCreateAddress(vm.addr(operatorKey), nonce)));
        assertEq(address(fresh.rootResolver()), address(root));
        assertEq(inner.rootRoles(address(fresh)), 0);
        vm.setEnv("GRANT_ROLES", "1");
    }

    function test_refusesAStepItDoesNotKnow() public {
        vm.setEnv("STEP", "explode");
        vm.expectRevert(bytes("STEP must be deploy, bridge, point, unpoint, unmount or remount"));
        script.run();
    }
}
