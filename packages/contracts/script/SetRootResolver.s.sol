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
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        IEthRegistryAdmin ethRegistry = IEthRegistryAdmin(vm.envAddress("ETH_REGISTRY"));
        string memory label = vm.envString("ROOT_LABEL");
        string memory parentName = vm.envString("ROOT_PARENT");
        bytes32 domain = bytes32(bytes(vm.envString("ROOT_DOMAIN")));

        vm.startBroadcast(pk);
        AttestationResolver resolver = new AttestationResolver(
            Multipass(payable(vm.envAddress("MULTIPASS"))),
            IPermissionedResolver(vm.envAddress("PERMISSIONED_RESOLVER")),
            domain,
            parentName
        );
        // ENSv2 addresses a name by token id: the labelhash with the version bits cleared.
        ethRegistry.setResolver(uint256(keccak256(bytes(label))) & ~uint256(type(uint32).max), address(resolver));
        vm.stopBroadcast();

        console.log("resolver", address(resolver));
        console.log("now serving", label, ethRegistry.getResolver(label));
    }
}
