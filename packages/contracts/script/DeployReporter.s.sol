// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationReporter} from "../src/AttestationReporter.sol";

/**
 * Give an existing deployment a Chainlink CRE write path. The reporter holds no privileges, so this
 * adds one contract and changes nothing else: no roles move, no addresses change.
 *
 *   MULTIPASS=… BRIDGE=… CRE_FORWARDER=… PRIVATE_KEY=… \
 *   forge script script/DeployReporter.s.sol --rpc-url $SEPOLIA_RPC --broadcast --verify
 */
contract DeployReporter is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address forwarder = vm.envAddress("CRE_FORWARDER");
        IMultipass mp = IMultipass(vm.envAddress("MULTIPASS"));
        AttestationBridge bridge = AttestationBridge(payable(vm.envAddress("BRIDGE")));

        vm.startBroadcast(pk);
        AttestationReporter reporter = new AttestationReporter(forwarder, mp, bridge);
        vm.stopBroadcast();

        console.log("reporter", address(reporter));
        console.log("forwarder", forwarder);
        console.log("bridge", address(bridge));
    }
}
