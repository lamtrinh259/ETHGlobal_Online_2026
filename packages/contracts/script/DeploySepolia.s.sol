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
///         Factory, AttestationFactory, AttestationBridge), the root instance mounted under `.eth`, and one
///         child instance nested beneath it. Multipass domains must already exist (`InitDomains.s.sol`);
///         mounting `<ROOT_LABEL>.eth` on the ETHRegistrar is `MountRoot.s.sol`.
///
///   Required env: PRIVATE_KEY, MULTIPASS, ETH_REGISTRY, VERIFIABLE_FACTORY, PERMISSIONED_RESOLVER_IMPL,
///                 ROOT_DOMAIN, ROOT_LABEL, CHILD_DOMAIN, CHILD_LABEL
///   Example:      ROOT_DOMAIN=ketsuban ROOT_LABEL=ketsuban CHILD_DOMAIN=kju-is CHILD_LABEL=kju-is
///                 → alice.ketsuban.eth and alice.kju-is.ketsuban.eth
contract DeploySepolia is Script {
    /// @dev EAC bitmaps use the low bit of every nybble (EACBaseRolesLib.ALL_ROLES).
    uint256 internal constant ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111;
    /// @dev Root roles the operator keeps on the stock resolver: everything except ROLE_SET_ADDR (A.9.5).
    uint256 internal constant OPERATOR_ROLES = ALL_ROLES & ~R.ROLE_SET_ADDR & ~(R.ROLE_SET_ADDR << 128);

    struct Deployed {
        address inner;
        AttestationFactory factory;
        AttestationBridge bridge;
        AttestationRegistry root;
        AttestationResolver rootResolver;
        AttestationRegistry child;
        AttestationResolver childResolver;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        string memory rootName = string.concat(vm.envString("ROOT_LABEL"), ".eth");
        string memory childName = string.concat(vm.envString("CHILD_LABEL"), ".", rootName);

        vm.startBroadcast(deployerKey);
        Deployed memory d = _deploy(vm.addr(deployerKey), rootName, childName);
        vm.stopBroadcast();

        _write(d, rootName, childName);
        console.log("factory", address(d.factory));
        console.log("bridge", address(d.bridge));
        console.log("root registry", address(d.root));
        console.log("child registry", address(d.child));
    }

    function _deploy(address deployer, string memory rootName, string memory childName)
        internal
        returns (Deployed memory d)
    {
        IMultipass mp = IMultipass(vm.envAddress("MULTIPASS"));
        IOwnedRegistry ethRegistry = IOwnedRegistry(vm.envAddress("ETH_REGISTRY"));
        d.inner = IVerifiableFactory(vm.envAddress("VERIFIABLE_FACTORY"))
            .deployProxy(
                vm.envAddress("PERMISSIONED_RESOLVER_IMPL"),
                uint256(keccak256(abi.encodePacked("ketsuban-resolver", deployer))),
                abi.encodeCall(IPermissionedResolverInit.initialize, (deployer, OPERATOR_ROLES, new bytes[](0)))
            );
        IPermissionedResolver inner = IPermissionedResolver(d.inner);
        d.factory = new AttestationFactory(mp, deployer);
        // KeystoneForwarder for this chain: the only caller allowed to deliver CRE reports.
        d.bridge = new AttestationBridge(
            mp, inner, ethRegistry, d.factory, deployer, vm.envAddress("CRE_FORWARDER")
        );
        (d.root, d.rootResolver) = d.factory
            .create(
                bytes32(bytes(vm.envString("ROOT_DOMAIN"))),
                IRegistry(address(ethRegistry)),
                vm.envString("ROOT_LABEL"),
                rootName,
                inner
            );
        (d.child, d.childResolver) = d.factory
            .create(
                bytes32(bytes(vm.envString("CHILD_DOMAIN"))),
                IRegistry(address(d.root)),
                vm.envString("CHILD_LABEL"),
                childName,
                inner
            );
        d.root.setSubregistry(vm.envString("CHILD_LABEL"), IRegistry(address(d.child)));
        IPermissionedResolverInit(d.inner).grantRootRoles(R.ROLE_SET_TEXT_ADMIN | R.ROLE_SET_ALIAS, address(d.bridge));
    }

    function _write(Deployed memory d, string memory rootName, string memory childName) internal {
        string memory json = "deployment";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "multipass", vm.envAddress("MULTIPASS"));
        vm.serializeAddress(json, "permissionedResolver", d.inner);
        vm.serializeAddress(json, "ethRegistry", vm.envAddress("ETH_REGISTRY"));
        vm.serializeAddress(json, "factory", address(d.factory));
        vm.serializeAddress(json, "bridge", address(d.bridge));
        vm.serializeAddress(json, "registry", address(d.root));
        vm.serializeAddress(json, "resolver", address(d.rootResolver));
        vm.serializeAddress(json, "childRegistry", address(d.child));
        vm.serializeAddress(json, "childResolver", address(d.childResolver));
        vm.serializeString(json, "instanceDomain", vm.envString("ROOT_DOMAIN"));
        vm.serializeString(json, "instanceParent", rootName);
        vm.serializeString(json, "childDomain", vm.envString("CHILD_DOMAIN"));
        string memory out = vm.serializeString(json, "childParent", childName);
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }
}
