// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Multipass} from "@peeramid-labs/multipass/src/Multipass.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationReporter} from "../src/AttestationReporter.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {PermissionedResolverRoles as R} from "../src/interfaces/IPermissionedResolver.sol";
import {MockPermissionedResolver} from "../test/mocks/MockPermissionedResolver.sol";
import {MockEthRegistry} from "../test/mocks/MockEthRegistry.sol";

/// @notice Local / e2e deployment: a fresh Multipass plus mocks for the ENSv2 pieces, one instance.
///         Writes `deployments/local.json` for the API and tests.
///
///   INSTANCE_DOMAIN=kju-is INSTANCE_PARENT=kju-is.eth REGISTRAR=0x... \
///   forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast
contract DeployLocal is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address registrar = vm.envAddress("REGISTRAR");
        string memory label = vm.envOr("INSTANCE_DOMAIN", string("kju-is"));
        string memory parentName = vm.envOr("INSTANCE_PARENT", string("kju-is.eth"));
        bytes32 domain = bytes32(bytes(label));

        vm.startBroadcast(deployerKey);
        Multipass mp = new Multipass(true);
        mp.initialize("MultipassDNS", "1.0.0", deployer);
        _domain(mp, registrar, domain, 0);
        // Every platform the attester may be asked for: Multipass reverts with `invalidDomain` on one
        // that was never initialised, and the user only finds out after signing.
        _domain(mp, registrar, "x", 0);
        _domain(mp, registrar, "telegram", 0);
        _domain(mp, registrar, "discord", 0);
        _domain(mp, registrar, "github", 0);
        _domain(mp, registrar, "google", 0);
        _domain(mp, registrar, "linkedin", 0);
        _domain(mp, registrar, "email", 0);
        _domain(mp, registrar, "humanity", 0);
        _domain(mp, registrar, "org", 0);

        MockPermissionedResolver inner = new MockPermissionedResolver(deployer);
        MockEthRegistry eth = new MockEthRegistry();
        AttestationFactory factory = new AttestationFactory(mp, deployer);
        AttestationBridge bridge = new AttestationBridge(mp, inner, eth, factory, deployer);
        // Local runs have no KeystoneForwarder; CRE simulation uses the mock address when set.
        AttestationReporter reporter = new AttestationReporter(vm.envOr("CRE_FORWARDER", deployer), mp, bridge);
        (AttestationRegistry registry, AttestationResolver resolver) =
            factory.create(domain, IRegistry(address(eth)), label, parentName, inner);
        eth.setLabel(label, deployer, registry, address(resolver));
        inner.grantRootRoles(R.ROLE_SET_TEXT_ADMIN | R.ROLE_SET_ALIAS, address(bridge));
        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "multipass", address(mp));
        vm.serializeAddress(json, "permissionedResolver", address(inner));
        vm.serializeAddress(json, "ethRegistry", address(eth));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "bridge", address(bridge));
        vm.serializeAddress(json, "reporter", address(reporter));
        vm.serializeAddress(json, "registry", address(registry));
        vm.serializeAddress(json, "resolver", address(resolver));
        vm.serializeString(json, "instanceDomain", label);
        string memory out = vm.serializeString(json, "instanceParent", parentName);
        vm.writeJson(out, "deployments/local.json");
        console.log("wrote deployments/local.json");
    }

    function _domain(Multipass mp, address registrar, bytes32 name, uint256 fee) internal {
        mp.initializeDomain(registrar, fee, 0, name, 0, 0);
        mp.activateDomain(name);
    }
}
