// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IETHRegistrar} from "@ensv2/registrar/IETHRegistrar.sol";

/// @notice Registers `<ROOT_LABEL>.eth` on the ENSv2 ETHRegistrar with the root instance as its subregistry
///         and resolver. Two runs: `STEP=commit` then, after MIN_COMMITMENT_AGE (60s), `STEP=register`.
///         The payment token is approved for the quoted price; mint test tokens first if the balance is short.
///
///   ETH_REGISTRAR=0x… ROOT_LABEL=ketsuban REGISTRY=0x… RESOLVER=0x… PAYMENT_TOKEN=0x… SECRET=0x… \
///   DURATION=2419200 STEP=commit forge script script/MountRoot.s.sol --rpc-url sepolia --broadcast
contract MountRoot is Script {
    struct Params {
        IETHRegistrar registrar;
        string label;
        IRegistry registry;
        address resolver;
        IERC20 token;
        bytes32 secret;
        uint64 duration;
        address owner;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        Params memory p = Params({
            registrar: IETHRegistrar(vm.envAddress("ETH_REGISTRAR")),
            label: vm.envString("ROOT_LABEL"),
            registry: IRegistry(vm.envAddress("REGISTRY")),
            resolver: vm.envAddress("RESOLVER"),
            token: IERC20(vm.envAddress("PAYMENT_TOKEN")),
            secret: vm.envBytes32("SECRET"),
            duration: uint64(vm.envOr("DURATION", uint256(2419200))),
            owner: vm.addr(deployerKey)
        });
        bool isCommit = keccak256(bytes(vm.envString("STEP"))) == keccak256("commit");

        vm.startBroadcast(deployerKey);
        if (isCommit) _commit(p);
        else _register(p);
        vm.stopBroadcast();
    }

    function _commit(Params memory p) internal {
        p.registrar
            .commit(
                p.registrar.makeCommitment(p.label, p.owner, p.secret, p.registry, p.resolver, p.duration, bytes32(0))
            );
        console.log("committed; register after MIN_COMMITMENT_AGE");
    }

    function _register(Params memory p) internal {
        (uint256 base, uint256 premium) = p.registrar.getRegisterPrice(p.label, p.duration, p.token);
        require(p.token.balanceOf(p.owner) >= base + premium, "insufficient payment token balance");
        p.token.approve(address(p.registrar), base + premium);
        uint256 tokenId =
            p.registrar.register(p.label, p.owner, p.secret, p.registry, p.resolver, p.duration, p.token, bytes32(0));
        console.log("registered", p.label, tokenId);
    }
}
