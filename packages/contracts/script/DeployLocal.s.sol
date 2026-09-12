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
import {RootAttestationResolver} from "../src/RootAttestationResolver.sol";
import {PermissionedResolverRoles as R} from "../src/interfaces/IPermissionedResolver.sol";
import {MockPermissionedResolver} from "../test/mocks/MockPermissionedResolver.sol";
import {MockEthRegistry} from "../test/mocks/MockEthRegistry.sol";

/// @notice Local / e2e deployment: a fresh Multipass plus mocks for the ENSv2 pieces, one instance.
///         Writes `deployments/local.json` for the API and tests.
///
///   INSTANCE_DOMAIN=kju-is INSTANCE_PARENT=kju-is.eth REGISTRAR=0x... \
///   forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast
///
///   ROOT_MODE=1 also deploys one wildcard resolver at the root and points the root label at it, so
///   the stack runs the way a migrated deployment does: the per-mount registries stand, unused.
contract DeployLocal is Script {
    struct Deployed {
        Multipass mp;
        MockPermissionedResolver inner;
        MockEthRegistry eth;
        AttestationFactory factory;
        AttestationBridge bridge;
        AttestationReporter reporter;
        AttestationRegistry registry;
        AttestationResolver resolver;
        address rootResolver;
        string label;
        string parentName;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        Deployed memory d;
        d.label = vm.envOr("INSTANCE_DOMAIN", string("kju-is"));
        d.parentName = vm.envOr("INSTANCE_PARENT", string("kju-is.eth"));

        vm.startBroadcast(deployerKey);
        d.mp = new Multipass(true);
        d.mp.initialize("MultipassDNS", "1.0.0", deployer);
        _domains(d.mp, vm.envAddress("REGISTRAR"), bytes32(bytes(d.label)));
        d.inner = new MockPermissionedResolver(deployer);
        d.eth = new MockEthRegistry();
        d.factory = new AttestationFactory(d.mp, deployer);
        d.bridge = new AttestationBridge(d.mp, d.inner, d.eth, d.factory, deployer);
        // Local runs have no KeystoneForwarder; CRE simulation uses the mock address when set.
        d.reporter = new AttestationReporter(vm.envOr("CRE_FORWARDER", deployer), d.mp, d.bridge);
        (d.registry, d.resolver) =
            d.factory.create(bytes32(bytes(d.label)), IRegistry(address(d.eth)), d.label, d.parentName, d.inner);
        d.eth.setLabel(d.label, deployer, d.registry, address(d.resolver));
        d.rootResolver = _rootMode(d, deployer);
        d.inner.grantRootRoles(R.ROLE_SET_TEXT_ADMIN | R.ROLE_SET_ALIAS, address(d.bridge));
        vm.stopBroadcast();

        _write(d);
    }

    /// @dev Every platform the attester may be asked for: Multipass reverts with `invalidDomain` on one
    ///      that was never initialised, and the user only finds out after signing.
    function _domains(Multipass mp, address registrar, bytes32 instance) internal {
        _domain(mp, registrar, instance, 0);
        _domain(mp, registrar, "x", 0);
        _domain(mp, registrar, "telegram", 0);
        _domain(mp, registrar, "discord", 0);
        _domain(mp, registrar, "github", 0);
        _domain(mp, registrar, "google", 0);
        _domain(mp, registrar, "linkedin", 0);
        _domain(mp, registrar, "email", 0);
        _domain(mp, registrar, "humanity", 0);
        _domain(mp, registrar, "org", 0);
    }

    /// @dev ROOT_MODE=1: one wildcard resolver at the root answers the whole tree from Multipass. The
    ///      root label's resolver is what the Universal Resolver falls back to for every level with no
    ///      registry of its own, which after migration is every level.
    function _rootMode(Deployed memory d, address deployer) internal returns (address) {
        if (vm.envOr("ROOT_MODE", uint256(0)) != 1) return address(0);
        RootAttestationResolver root =
            new RootAttestationResolver(d.mp, d.inner, bytes32(bytes(d.label)), d.parentName, deployer);
        d.eth.setLabel(d.label, deployer, IRegistry(address(0)), address(root));
        d.bridge.setRootResolver(root);
        return address(root);
    }

    function _write(Deployed memory d) internal {
        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "multipass", address(d.mp));
        vm.serializeAddress(json, "permissionedResolver", address(d.inner));
        vm.serializeAddress(json, "ethRegistry", address(d.eth));
        vm.serializeAddress(json, "factory", address(d.factory));
        // One factory here is new enough to carry the namespace, so it is both.
        vm.serializeAddress(json, "namespaceFactory", address(d.factory));
        vm.serializeAddress(json, "bridge", address(d.bridge));
        vm.serializeAddress(json, "reporter", address(d.reporter));
        vm.serializeAddress(json, "registry", address(d.registry));
        vm.serializeAddress(json, "resolver", address(d.resolver));
        // `rootResolver` is taken: the Sepolia file uses it for the root instance's own resolver.
        if (d.rootResolver != address(0)) vm.serializeAddress(json, "wildcardResolver", d.rootResolver);
        vm.serializeString(json, "instanceDomain", d.label);
        string memory out = vm.serializeString(json, "instanceParent", d.parentName);
        vm.writeJson(out, "deployments/local.json");
        console.log("wrote deployments/local.json");
    }

    function _domain(Multipass mp, address registrar, bytes32 name, uint256 fee) internal {
        mp.initializeDomain(registrar, fee, 0, name, 0, 0);
        mp.activateDomain(name);
    }
}
