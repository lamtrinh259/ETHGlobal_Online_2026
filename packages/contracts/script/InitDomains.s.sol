// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";

/// @notice Multipass owner action: initialise + activate every domain the deployment needs, idempotently.
///         Run with the owner as signer (`--mnemonics … --mnemonic-indexes <owner>`), never with a key in env.
///
///   MULTIPASS=0x… REGISTRAR=0x… DOMAINS=ketsuban,kju-is,x,telegram,humanity,org \
///   forge script script/InitDomains.s.sol --rpc-url sepolia --mnemonics "$M" --mnemonic-indexes 1 --broadcast
contract InitDomains is Script {
    function run() external {
        IMultipass mp = IMultipass(vm.envAddress("MULTIPASS"));
        address registrar = vm.envAddress("REGISTRAR");
        string[] memory domains = vm.split(vm.envString("DOMAINS"), ",");
        uint256 fee = vm.envOr("DOMAIN_FEE", uint256(0));

        vm.startBroadcast();
        for (uint256 i; i < domains.length; ++i) {
            bytes32 name = bytes32(bytes(domains[i]));
            LibMultipass.Domain memory d = mp.getDomainState(name);
            if (d.name == bytes32(0)) {
                mp.initializeDomain(registrar, fee, 0, name, 0, 0);
                console.log("initialized", domains[i]);
            } else if (d.registrar != registrar) {
                mp.changeRegistrar(name, registrar);
                console.log("registrar changed", domains[i]);
            }
            if (!d.isActive) {
                mp.activateDomain(name);
                console.log("activated", domains[i]);
            }
        }
        vm.stopBroadcast();
    }
}
