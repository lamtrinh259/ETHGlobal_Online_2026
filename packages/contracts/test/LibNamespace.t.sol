// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LibNamespace} from "../src/libraries/LibNamespace.sol";

/// @dev `expectRevert` needs a call boundary, and a library call inlines.
contract NamespaceHarness {
    function split(string calldata dns) external pure returns (string[] memory) {
        return LibNamespace.split(dns);
    }
}

contract LibNamespaceTest is Test {
    NamespaceHarness internal harness = new NamespaceHarness();

    function test_splitsADnsNameLeftToRight() public pure {
        string[] memory labels = LibNamespace.split("x.com");
        assertEq(labels.length, 2);
        assertEq(labels[0], "x");
        assertEq(labels[1], "com");

        labels = LibNamespace.split("tenant.acme.com");
        assertEq(labels.length, 3);
        assertEq(labels[0], "tenant");
        assertEq(labels[2], "com");

        labels = LibNamespace.split("localhost");
        assertEq(labels.length, 1);
        assertEq(labels[0], "localhost");
    }

    function test_refusesAnEmptyLabel() public {
        vm.expectRevert(abi.encodeWithSelector(LibNamespace.EmptyLabel.selector, "x..com"));
        harness.split("x..com");
        vm.expectRevert(abi.encodeWithSelector(LibNamespace.EmptyLabel.selector, ".com"));
        harness.split(".com");
        vm.expectRevert(abi.encodeWithSelector(LibNamespace.EmptyLabel.selector, "x."));
        harness.split("x.");
    }

    function test_readsTheWalkBackwardsIntoAName() public pure {
        string[] memory walk = new string[](3);
        walk[0] = "www";
        walk[1] = "x";
        walk[2] = "com";
        assertEq(LibNamespace.join(walk, "acme.eth"), "com.x.www.acme.eth");
        assertEq(LibNamespace.join(new string[](0), "acme.eth"), "acme.eth");
    }
}
