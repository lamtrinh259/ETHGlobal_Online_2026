// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SetRootResolver, IEthRegistryAdmin} from "../script/SetRootResolver.s.sol";
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

        new SetRootResolver()
            .runWith(
                SetRootResolver.Params({
                    pk: OPERATOR_KEY,
                    ethRegistry: IEthRegistryAdmin(address(ethRegistry)),
                    mp: mp,
                    inner: inner,
                    label: LABEL,
                    parentName: PARENT,
                    domain: bytes32(bytes(LABEL))
                })
            );

        AttestationResolver replaced = AttestationResolver(ethRegistry.getResolver(LABEL));
        assertTrue(address(replaced) != before, "a new resolver serves the name");
        assertEq(replaced.parentName(), PARENT);

        // It answers for a name one label under the root, and for nothing deeper.
        registerName(alice, "alice", "");
        assertEq(resolveAddr(replaced, "alice.acme-alumni.eth"), alice);
        assertEq(resolveAddr(replaced, "alice.com.x.private-www.acme-alumni.eth"), address(0));
    }
}
