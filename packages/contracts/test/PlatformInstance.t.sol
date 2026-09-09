// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * A linked account becomes a name too. Giving a platform domain its own instance, nested under the
 * root registry, makes `<handle>.<platform>.<root>` resolve — so attesting an account is visible to any
 * ENS client rather than only through this project's own endpoints.
 *
 * A masked record carries no handle on chain, so its label is the masked bytes: a verifier can prove
 * the account exists without learning which it is.
 */
contract PlatformInstanceTest is BaseTest {
    AttestationRegistry internal xRegistry;
    AttestationResolver internal xResolver;

    function setUp() public override {
        super.setUp();
        vm.prank(operator);
        (xRegistry, xResolver) = factory.create(X, IRegistry(address(registry)), "x", "x.acme-alumni.eth", inner);
        vm.prank(operator);
        registry.setSubregistry("x", IRegistry(address(xRegistry)));
    }

    function test_publicAccount_resolvesAsAName() public {
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        registerVia(alice, r, X_FEE);

        assertEq(
            resolveAddr(xResolver, "alice_x.x.acme-alumni.eth"),
            alice,
            "the account's own name answers with the wallet that holds it"
        );
        assertEq(resolveAddr(xResolver, "nobody.x.acme-alumni.eth"), address(0));
    }

    function test_theRootRegistryDelegatesToIt() public view {
        assertEq(address(registry.getSubregistry("x")), address(xRegistry));
        assertEq(registry.getResolver("x"), address(0), "the platform label has no resolver of its own");
    }

    function test_maskedAccount_provesExistenceWithoutTheHandle() public {
        // A masked record's name is the XOR-masked label, so the name exists but reads as nothing.
        bytes32 masked = bytes32(uint256(keccak256("masked-alice")));
        LibMultipass.Record memory r = record(X, bob, masked, b32("2"), 1, bytes32(uint256(1)));
        registerVia(bob, r, X_FEE);

        (bool ok, LibMultipass.Record memory stored) =
            mp.resolveRecord(LibMultipass.NameQuery(X, bob, bytes32(0), bytes32(0), bytes32(0)));
        assertTrue(ok);
        assertEq(stored.name, masked, "nothing readable was published");
        assertEq(resolveAddr(xResolver, "alice_x.x.acme-alumni.eth"), address(0), "and it is not alice_x");
    }
}
