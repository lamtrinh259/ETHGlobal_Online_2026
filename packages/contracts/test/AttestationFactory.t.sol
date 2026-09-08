// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {BaseTest} from "./Base.t.sol";

contract AttestationFactoryTest is BaseTest {
    function test_createWiresInstance() public {
        vm.prank(operator);
        vm.expectEmit(true, false, false, false, address(factory));
        emit AttestationFactory.InstanceCreated("uni", address(0), address(0), address(ethRegistry), "uni", "uni.eth");
        (AttestationRegistry reg, AttestationResolver res) = factory.create("uni", ethRegistry, "uni", "uni.eth", inner);

        AttestationFactory.Instance memory i = factory.instance("uni");
        assertEq(address(i.registry), address(reg));
        assertEq(address(i.resolver), address(res));
        assertEq(address(i.parent), address(ethRegistry));
        assertEq(i.parentLabel, "uni");
        assertEq(i.parentName, "uni.eth");

        assertEq(reg.DOMAIN(), "uni");
        assertEq(reg.RESOLVER(), address(res));
        assertEq(reg.owner(), operator);
        assertEq(res.DOMAIN(), "uni");
        assertEq(res.parentName(), "uni.eth");
        assertEq(address(res.INNER()), address(inner));

        assertEq(factory.parentNameOf("uni"), "uni.eth");
        assertTrue(factory.isInstance("uni"));
        bytes32[] memory ds = factory.domains();
        assertEq(ds.length, 2);
        assertEq(ds[0], INSTANCE);
        assertEq(ds[1], "uni");
    }

    function test_createRejectsDuplicateDomain() public {
        vm.prank(operator);
        vm.expectRevert(abi.encodeWithSelector(AttestationFactory.InstanceExists.selector, INSTANCE));
        factory.create(INSTANCE, ethRegistry, LABEL, PARENT, inner);
    }

    function test_createOnlyOwner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        factory.create("uni", ethRegistry, "uni", "uni.eth", inner);
    }

    function test_unknownInstance() public {
        assertFalse(factory.isInstance("nope"));
        vm.expectRevert(abi.encodeWithSelector(AttestationFactory.UnknownInstance.selector, bytes32("nope")));
        factory.parentNameOf("nope");
    }
}
