// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {Multipass} from "@peeramid-labs/multipass/src/Multipass.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {GroupingRegistry} from "../src/GroupingRegistry.sol";
import {MaskedMirrorRegistry} from "../src/MaskedMirrorRegistry.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";
import {LibNamespace} from "../src/libraries/LibNamespace.sol";

/**
 * Mount a platform at the DNS name it actually is. An account on X becomes `alice.com.x.www.<root>`
 * rather than `alice.x.<root>`, which collides with a person called `x` and says nothing about which
 * service. An email lands under the at-sign level instead, because an address is not a handle:
 * `tim.xyz.peeramid.<at>.<root>`, where `<at>` is the at-sign written on its own.
 *
 * Each DNS name gets two mounts. The open branch names accounts by their handle. The private mirror
 * under `private-www` (or the private at-sign level) names them by the person holding them, as in
 * `alice.com.x.private-www.<root>`, because a masked name is a one-time pad over the handle and cannot
 * be a label anyone could ask for.
 *
 * Idempotent: a grouping level or instance that already exists is reused, so this can be re-run to add
 * one more platform without disturbing the ones already deployed.
 *
 *   FACTORY=0x… REGISTRY=0x… MULTIPASS=0x… PERMISSIONED_RESOLVER=0x… REGISTRAR=0x… \
 *   ROOT_PARENT=ketsuban.eth ROOT_DOMAIN=ketsuban \
 *   WWW_NAMES=x.com,github.com,google.com,discord.com,linkedin.com,t.me AT_NAMES=peeramid.xyz \
 *   PRIVATE_KEY=$OPERATOR_KEY forge script script/AddNamespace.s.sol --rpc-url $RPC --broadcast
 */
contract AddNamespace is Script {
    AttestationFactory internal factory;
    AttestationRegistry internal root;
    Multipass internal mp;
    IPermissionedResolver internal inner;
    address internal registrar;
    string internal rootParent;
    bytes32 internal rootDomain;
    /// @dev The broadcasting key's address: what a level created here must be owned by.
    address internal operator;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        factory = AttestationFactory(vm.envAddress("FACTORY"));
        root = AttestationRegistry(vm.envAddress("REGISTRY"));
        mp = Multipass(payable(vm.envAddress("MULTIPASS")));
        inner = IPermissionedResolver(vm.envAddress("PERMISSIONED_RESOLVER"));
        registrar = vm.envAddress("REGISTRAR");
        rootParent = vm.envString("ROOT_PARENT");
        rootDomain = bytes32(bytes(vm.envString("ROOT_DOMAIN")));
        operator = vm.addr(pk);

        vm.startBroadcast(pk);
        _branch(vm.split(vm.envOr("WWW_NAMES", string("")), ","), "www", "private-www");
        _branch(vm.split(vm.envOr("AT_NAMES", string("")), ","), "@", "private@");
        vm.stopBroadcast();
    }

    function _branch(string[] memory names, string memory open, string memory masked) internal {
        for (uint256 i; i < names.length; ++i) {
            if (bytes(names[i]).length == 0) continue;
            _mount(names[i], open, false);
            _mount(names[i], masked, true);
        }
    }

    /// @notice Walk the grouping levels for one DNS name, creating what is missing, then the instance.
    function _mount(string memory dns, string memory group, bool mirror) internal {
        string[] memory labels = LibNamespace.split(dns);
        bytes32 domain = bytes32(bytes(dns));
        if (!mirror) _domain(domain);

        string[] memory walk = new string[](1);
        walk[0] = group;
        IRegistry parent = _level(IRegistry(address(root)), group, walk);
        for (uint256 i; i + 1 < labels.length; ++i) {
            walk = _push(walk, labels[i]);
            parent = _level(parent, labels[i], walk);
        }

        string memory label = labels[labels.length - 1];
        string memory parentName = LibNamespace.join(_push(walk, label), rootParent);
        if (mirror) {
            if (address(factory.mirror(domain).registry) != address(0)) {
                console.log("mirror exists", parentName);
                return;
            }
            (MaskedMirrorRegistry reg,) = factory.createMirror(domain, rootDomain, parent, label, parentName, inner);
            _link(parent, label, IRegistry(address(reg)));
            console.log("mirror", parentName, address(reg));
        } else {
            if (factory.isInstance(domain)) {
                console.log("instance exists", parentName);
                return;
            }
            (AttestationRegistry reg,) =
                factory.create(domain, parent, label, parentName, inner, AttestationRegistry.Visibility.Public);
            _link(parent, label, IRegistry(address(reg)));
            console.log("instance", parentName, address(reg));
        }
    }

    /// @dev The grouping level under `parent`, created and mounted when it is not there yet.
    function _level(IRegistry parent, string memory label, string[] memory walk) internal returns (IRegistry) {
        IRegistry existing = parent.getSubregistry(label);
        if (address(existing) != address(0)) return existing;
        GroupingRegistry level = new GroupingRegistry(parent, label, operator);
        _link(parent, label, IRegistry(address(level)));
        console.log("level", LibNamespace.join(walk, rootParent), address(level));
        return IRegistry(address(level));
    }

    /// @dev Mount a child. The root is an attestation instance, the levels below it are grouping ones.
    function _link(IRegistry parent, string memory label, IRegistry child) internal {
        if (address(parent) == address(root)) {
            root.setSubregistry(label, child);
        } else {
            GroupingRegistry(address(parent)).setSubregistry(label, child);
        }
    }

    /// @dev Multipass reverts with `invalidDomain` on a domain nobody initialised, and the user only
    ///      finds out after signing. Names longer than 31 bytes cannot be a domain at all.
    function _domain(bytes32 domain) internal {
        if (mp.getDomainState(domain).registrar != address(0)) return;
        mp.initializeDomain(registrar, 0, 0, domain, 0, 0);
        mp.activateDomain(domain);
    }

    function _push(string[] memory list, string memory item) internal pure returns (string[] memory out) {
        out = new string[](list.length + 1);
        for (uint256 i; i < list.length; ++i) {
            out[i] = list[i];
        }
        out[list.length] = item;
    }
}
