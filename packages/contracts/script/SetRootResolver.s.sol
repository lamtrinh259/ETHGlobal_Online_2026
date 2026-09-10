// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Multipass} from "@peeramid-labs/multipass/src/Multipass.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";

interface IEthRegistryAdmin {
    function setResolver(uint256 tokenId, address resolver) external;
    function getResolver(string calldata label) external view returns (address);
}

/**
 * Point the `.eth` name's resolver at a build that answers for its own children only.
 *
 * The Universal Resolver falls back to the nearest ancestor resolver when a level has none, and that
 * ancestor is this one: without the check, `alice.<anything>.<root>` resolved as `alice` and a person
 * appeared to hold accounts they never attested. Replacing this one resolver fixes every name beneath
 * it, because every fallback ends here.
 *
 *   ETH_REGISTRY=0x… ROOT_LABEL=ketsuban ROOT_DOMAIN=ketsuban ROOT_PARENT=ketsuban.eth \
 *   MULTIPASS=0x… PERMISSIONED_RESOLVER=0x… PRIVATE_KEY=$OPERATOR_KEY \
 *   forge script script/SetRootResolver.s.sol --rpc-url $RPC --broadcast
 */
contract SetRootResolver is Script {
    struct Params {
        uint256 pk;
        IEthRegistryAdmin ethRegistry;
        Multipass mp;
        IPermissionedResolver inner;
        string label;
        string parentName;
        bytes32 domain;
    }

    function run() external {
        runWith(
            Params({
                pk: vm.envUint("PRIVATE_KEY"),
                ethRegistry: IEthRegistryAdmin(vm.envAddress("ETH_REGISTRY")),
                mp: Multipass(payable(vm.envAddress("MULTIPASS"))),
                inner: IPermissionedResolver(vm.envAddress("PERMISSIONED_RESOLVER")),
                label: vm.envString("ROOT_LABEL"),
                parentName: vm.envString("ROOT_PARENT"),
                domain: bytes32(bytes(vm.envString("ROOT_DOMAIN")))
            })
        );
    }

    /// @notice The same work, from values a caller already holds: a test has no business exporting them.
    function runWith(Params memory p) public returns (AttestationResolver resolver) {
        vm.startBroadcast(p.pk);
        resolver = new AttestationResolver(p.mp, p.inner, p.domain, p.parentName, vm.addr(p.pk));
        // ENSv2 addresses a name by token id: the labelhash with the version bits cleared.
        p.ethRegistry.setResolver(uint256(keccak256(bytes(p.label))) & ~uint256(type(uint32).max), address(resolver));
        vm.stopBroadcast();

        console.log("resolver", address(resolver));
        console.log("now serving", p.label, p.ethRegistry.getResolver(p.label));
    }
}
