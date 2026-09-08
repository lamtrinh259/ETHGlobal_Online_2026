// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IOwnedRegistry} from "@ensv2/registry/IOwnedRegistry.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {IPermissionedResolver, PermissionedResolverRoles as R} from "../src/interfaces/IPermissionedResolver.sol";

interface IVerifiableFactory {
    function deployProxy(address implementation, uint256 salt, bytes memory data) external returns (address);
}

interface IPermissionedResolverInit {
    function initialize(address admin, uint256 roleBitmap, bytes[] calldata setters) external;
    function grantRootRoles(uint256 roleBitmap, address account) external returns (bool);
}

/// @notice Sepolia deployment of the shared pieces (stock PermissionedResolver via the ENS Verifiable
///         Factory, AttestationFactory, AttestationBridge) and the first instance. The instance's
///         Multipass domain must already exist (Multipass owner action) and the deployer must own
///         `<INSTANCE_LABEL>.eth` to mount it afterwards (see `MountInstance.s.sol`).
///
///   Required env: PRIVATE_KEY, MULTIPASS, ETH_REGISTRY, VERIFIABLE_FACTORY, PERMISSIONED_RESOLVER_IMPL,
///                 INSTANCE_DOMAIN, INSTANCE_LABEL, INSTANCE_PARENT
contract DeploySepolia is Script {
    /// @dev Root roles the operator keeps on the stock resolver: everything except ROLE_SET_ADDR (A.9.5).
    uint256 internal constant OPERATOR_ROLES = type(uint256).max & ~R.ROLE_SET_ADDR & ~(R.ROLE_SET_ADDR << 128);

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        IMultipass mp = IMultipass(vm.envAddress("MULTIPASS"));
        IOwnedRegistry ethRegistry = IOwnedRegistry(vm.envAddress("ETH_REGISTRY"));
        IVerifiableFactory vf = IVerifiableFactory(vm.envAddress("VERIFIABLE_FACTORY"));
        address resolverImpl = vm.envAddress("PERMISSIONED_RESOLVER_IMPL");
        string memory label = vm.envString("INSTANCE_LABEL");
        string memory parentName = vm.envString("INSTANCE_PARENT");
        bytes32 domain = bytes32(bytes(vm.envString("INSTANCE_DOMAIN")));

        vm.startBroadcast(deployerKey);
        address inner = vf.deployProxy(
            resolverImpl,
            uint256(keccak256(abi.encodePacked("attestation-resolver", deployer))),
            abi.encodeCall(IPermissionedResolverInit.initialize, (deployer, OPERATOR_ROLES, new bytes[](0)))
        );
        AttestationFactory factory = new AttestationFactory(mp, deployer);
        AttestationBridge bridge =
            new AttestationBridge(mp, IPermissionedResolver(inner), ethRegistry, factory, deployer);
        (AttestationRegistry registry, AttestationResolver resolver) =
            factory.create(domain, IRegistry(address(ethRegistry)), label, parentName, IPermissionedResolver(inner));
        IPermissionedResolverInit(inner).grantRootRoles(R.ROLE_SET_TEXT_ADMIN | R.ROLE_SET_ALIAS, address(bridge));
        vm.stopBroadcast();

        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "multipass", address(mp));
        vm.serializeAddress(json, "permissionedResolver", inner);
        vm.serializeAddress(json, "ethRegistry", address(ethRegistry));
        vm.serializeAddress(json, "factory", address(factory));
        vm.serializeAddress(json, "bridge", address(bridge));
        vm.serializeAddress(json, "registry", address(registry));
        vm.serializeAddress(json, "resolver", address(resolver));
        vm.serializeString(json, "instanceDomain", vm.envString("INSTANCE_DOMAIN"));
        string memory out = vm.serializeString(json, "instanceParent", parentName);
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console.log("factory", address(factory));
        console.log("bridge", address(bridge));
        console.log("registry", address(registry));
        console.log("resolver", address(resolver));
    }
}
