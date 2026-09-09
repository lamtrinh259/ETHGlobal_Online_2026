// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Multipass} from "@peeramid-labs/multipass/src/Multipass.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";

/**
 * A second factory for a deployment whose first one predates the DNS namespace and cannot build it.
 * The bridge keeps using the original: it only asks the factory about the domains it knows, and skips
 * quietly for any it does not, so records written into the new instances still go through unchanged.
 *
 *   MULTIPASS=0x… PRIVATE_KEY=$OPERATOR_KEY forge script script/DeployFactory.s.sol --rpc-url $RPC --broadcast
 */
contract DeployFactory is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        Multipass mp = Multipass(payable(vm.envAddress("MULTIPASS")));
        vm.startBroadcast(pk);
        AttestationFactory factory = new AttestationFactory(mp, vm.addr(pk));
        vm.stopBroadcast();
        console.log("namespaceFactory", address(factory));
    }
}
