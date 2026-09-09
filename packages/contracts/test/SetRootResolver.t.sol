// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SetRootResolver} from "../script/SetRootResolver.s.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * Every fallback in the tree ends at the resolver the `.eth` registry names, so replacing that one
 * contract is what stops a deployment from answering for names that are not its own.
 */
contract SetRootResolverTest is BaseTest {
    uint256 internal constant OPERATOR_KEY = 0x0FE7B;

    function test_pointsTheNameAtAResolverThatAnswersForItsOwnChildrenOnly() public {
        address before = ethRegistry.getResolver(LABEL);
        assertEq(before, address(shim), "starts on the instance resolver");

        vm.setEnv("PRIVATE_KEY", vm.toString(OPERATOR_KEY));
        vm.setEnv("ETH_REGISTRY", vm.toString(address(ethRegistry)));
        vm.setEnv("ROOT_LABEL", LABEL);
        vm.setEnv("ROOT_PARENT", PARENT);
        vm.setEnv("ROOT_DOMAIN", LABEL);
        vm.setEnv("MULTIPASS", vm.toString(address(mp)));
        vm.setEnv("PERMISSIONED_RESOLVER", vm.toString(address(inner)));
        new SetRootResolver().run();

        AttestationResolver replaced = AttestationResolver(ethRegistry.getResolver(LABEL));
        assertTrue(address(replaced) != before, "a new resolver serves the name");
        assertEq(replaced.parentName(), PARENT);

        // It answers for a name one label under the root, and for nothing deeper.
        registerName(alice, "alice", "");
        assertEq(resolveAddr(replaced, "alice.acme-alumni.eth"), alice);
        assertEq(resolveAddr(replaced, "alice.com.x.private-www.acme-alumni.eth"), address(0));
    }
}
