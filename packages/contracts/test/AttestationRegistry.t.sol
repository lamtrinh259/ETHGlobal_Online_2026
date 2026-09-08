// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {IRegistryEvents} from "@ensv2/registry/IRegistryEvents.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {BaseTest} from "./Base.t.sol";

contract AttestationRegistryTest is BaseTest {
    function test_noSubregistryByDefault() public view {
        assertEq(address(registry.getSubregistry("fatpig")), address(0));
    }

    function test_ownerMountsChildInstance() public {
        vm.prank(operator);
        (AttestationRegistry child,) =
            factory.create("acme-2030", IRegistry(address(registry)), "2030", "2030.acme-alumni.eth", inner);

        vm.prank(operator);
        vm.expectEmit(true, true, true, true, address(registry));
        emit IRegistryEvents.SubregistryUpdated(uint256(keccak256("2030")), IRegistry(address(child)), operator);
        registry.setSubregistry("2030", IRegistry(address(child)));

        assertEq(address(registry.getSubregistry("2030")), address(child));
        (IRegistry parent, string memory label) = child.getParent();
        assertEq(address(parent), address(registry));
        assertEq(label, "2030");
    }

    function test_nonOwnerCannotMount() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        registry.setSubregistry("2030", IRegistry(address(1)));
    }

    function test_parentIsEthRegistryUnderInstanceLabel() public view {
        (IRegistry parent, string memory label) = registry.getParent();
        assertEq(address(parent), address(ethRegistry));
        assertEq(label, LABEL);
    }

    function test_resolverIsZeroForUnknownLabel() public view {
        assertEq(registry.getResolver("fatpig"), address(0));
    }

    function test_resolverIsShimWhileRecordLive_thenZeroAfterExpiry() public {
        registerName(alice, "fatpig", "terrible dictator");
        assertEq(registry.getResolver("fatpig"), address(shim));

        vm.warp(block.timestamp + TERM - 1);
        assertEq(registry.getResolver("fatpig"), address(shim), "live until validUntil");

        vm.warp(block.timestamp + 1);
        assertEq(registry.getResolver("fatpig"), address(0), "dark at validUntil");
    }

    function test_labelLongerThan31BytesIsNotAName() public view {
        assertEq(registry.getResolver("this-label-is-way-too-long-for-a-bytes32-slot"), address(0));
        assertEq(registry.getResolver(""), address(0));
    }

    function test_immutables() public view {
        assertEq(address(registry.MP()), address(mp));
        assertEq(registry.RESOLVER(), address(shim));
        assertEq(registry.DOMAIN(), INSTANCE);
        assertEq(registry.owner(), operator);
    }
}
