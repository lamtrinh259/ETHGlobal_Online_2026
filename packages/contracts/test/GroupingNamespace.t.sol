// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {GroupingRegistry} from "../src/GroupingRegistry.sol";
import {MaskedMirrorRegistry} from "../src/MaskedMirrorRegistry.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * A platform is a DNS name and should read as one: `alice.com.x.www.<root>` rather than
 * `alice.x.<root>`, which collides with a person called `x` and says nothing about which service.
 *
 * The DNS name mounts first label first, so `x.com` becomes `com` under `x` under `www`. A service
 * that hands out subdomains keeps them apart that way: `tenant.acme.com` is its own chain and never
 * has to share a level with the accounts of `acme.com`.
 *
 * The grouping levels are shared, so a new platform costs one instance for everybody rather than one
 * per person. An account kept behind a view code lives in the mirror branch under `private-www`,
 * named after the person rather than the account: `alice.com.x.private-www.<root>` says the holder of
 * `alice.<root>` is on X and stops there. The two branches never answer for each other's records.
 */
contract GroupingNamespaceTest is BaseTest {
    bytes32 internal constant XCOM = "x.com";
    /// @dev Stands in for `maskName(handle, viewCode)`: a one-time pad, so arbitrary bytes.
    bytes32 internal constant MASKED = bytes32(bytes31(keccak256("masked alice_x")));

    GroupingRegistry internal www;
    GroupingRegistry internal x;
    GroupingRegistry internal privateWww;
    GroupingRegistry internal privateX;
    AttestationRegistry internal publicX;
    AttestationResolver internal publicXResolver;
    MaskedMirrorRegistry internal maskedX;
    AttestationResolver internal maskedXResolver;

    function setUp() public override {
        super.setUp();
        vm.startPrank(treasury);
        mp.initializeDomain(registrar, 0, 0, XCOM, 0, 0);
        mp.activateDomain(XCOM);
        vm.stopPrank();

        vm.startPrank(operator);
        www = _group(IRegistry(address(registry)), "www");
        registry.setSubregistry("www", IRegistry(address(www)));
        x = _group(IRegistry(address(www)), "x");
        www.setSubregistry("x", IRegistry(address(x)));

        privateWww = _group(IRegistry(address(registry)), "private-www");
        registry.setSubregistry("private-www", IRegistry(address(privateWww)));
        privateX = _group(IRegistry(address(privateWww)), "x");
        privateWww.setSubregistry("x", IRegistry(address(privateX)));

        (publicX, publicXResolver) = factory.create(
            XCOM,
            IRegistry(address(x)),
            "com",
            "com.x.www.acme-alumni.eth",
            inner,
            AttestationRegistry.Visibility.Public
        );
        x.setSubregistry("com", IRegistry(address(publicX)));
        (maskedX, maskedXResolver) = factory.createMirror(
            XCOM, INSTANCE, IRegistry(address(privateX)), "com", "com.x.private-www.acme-alumni.eth", inner
        );
        privateX.setSubregistry("com", IRegistry(address(maskedX)));
        vm.stopPrank();
    }

    function _group(IRegistry parent, string memory label) internal returns (GroupingRegistry) {
        return new GroupingRegistry(parent, label, operator);
    }

    /// @dev A record in the platform domain. A non-zero payload is the view-code commitment: masked.
    function account(bytes32 name, bytes32 payload) internal {
        registerVia(alice, record(XCOM, alice, name, keccak256(abi.encodePacked(name)), 1, payload), 0);
    }

    function test_anInstanceAnswersForItsOwnChildrenOnly() public {
        // The Universal Resolver falls back to the nearest ancestor resolver when a level has none, so
        // without a check the root would answer for every name beneath it and a person would appear to
        // hold an account on a platform they never attested.
        registerName(alice, "alice", "");
        assertEq(resolveAddr("alice.acme-alumni.eth"), alice, "her own name still resolves");
        assertEq(resolveAddr("alice.com.x.private-www.acme-alumni.eth"), address(0), "not the root's to answer");
        assertEq(resolveAddr("alice.anything.acme-alumni.eth"), address(0));
        assertEq(resolveText("alice.com.x.private-www.acme-alumni.eth", "ketsuban:answer"), "");

        // The mirror answers for the name that is genuinely its own.
        account(MASKED, keccak256("view code commitment"));
        assertEq(resolveAddr(maskedXResolver, "alice.com.x.private-www.acme-alumni.eth"), alice);
        // And still not for a platform she has no masked account on.
        assertEq(resolveAddr(publicXResolver, "alice.com.x.www.acme-alumni.eth"), address(0));
    }

    function test_theMirrorIsAMountLikeAnyOther() public {
        // It nests, it names its parent, and it says nothing for a label no name domain could hold.
        vm.prank(operator);
        maskedX.setSubregistry("tenant", IRegistry(address(privateX)));
        assertEq(address(maskedX.getSubregistry("tenant")), address(privateX));
        assertEq(address(maskedX.getSubregistry("absent")), address(0));
        (IRegistry parent, string memory label) = maskedX.getParent();
        assertEq(address(parent), address(privateX));
        assertEq(label, "com");
        assertEq(maskedX.getResolver("a-label-far-longer-than-thirty-one-bytes-can-hold"), address(0));
    }

    function test_theWalkReachesBothBranches() public view {
        assertEq(address(registry.getSubregistry("www")), address(www));
        assertEq(address(www.getSubregistry("x")), address(x));
        assertEq(address(x.getSubregistry("com")), address(publicX));
        assertEq(address(registry.getSubregistry("private-www")), address(privateWww));
        assertEq(address(privateX.getSubregistry("com")), address(maskedX));
        // A grouping level is a path, not a name: nothing resolves at it.
        assertEq(www.getResolver("x"), address(0));
        (IRegistry parent, string memory label) = x.getParent();
        assertEq(address(parent), address(www));
        assertEq(label, "x");
    }

    function test_aPublicAccountResolvesUnderItsPlatformDomain() public {
        account(b32("alice_x"), bytes32(0));

        assertEq(resolveAddr(publicXResolver, "alice_x.com.x.www.acme-alumni.eth"), alice);
        assertEq(resolveAddr(publicXResolver, "nobody.com.x.www.acme-alumni.eth"), address(0));
        // The mirror is for masked records; a public one is not among them.
        assertEq(maskedX.getResolver("alice_x"), address(0));
    }

    function test_aMaskedAccountIsNamedAfterThePersonHoldingIt() public {
        registerName(alice, "alice", "");
        // The stored name is a one-time pad over the handle: not a label anyone could ask for.
        account(MASKED, keccak256("view code commitment"));

        assertEq(maskedX.getResolver("alice"), address(maskedXResolver));
        assertEq(resolveAddr(maskedXResolver, "alice.com.x.private-www.acme-alumni.eth"), alice);
        // It says the holder of alice.<root> is on X. Which account stays behind the view code.
        assertEq(publicX.getResolver("alice"), address(0));
        assertEq(maskedX.getResolver("bob"), address(0));
        // DNS labels carry arbitrary octets, so the masked name is askable. The open branch still refuses.
        assertEq(publicX.getResolver(string(abi.encodePacked(bytes31(MASKED)))), address(0));
    }

    function test_theMirrorIsSilentWithoutAMaskedAccount() public {
        registerName(alice, "alice", "");
        assertEq(maskedX.getResolver("alice"), address(0), "no account at all");

        account(b32("alice_x"), bytes32(0));
        assertEq(maskedX.getResolver("alice"), address(0), "a public account is named in the open branch");
    }

    function test_theMirrorForgetsAnExpiredName() public {
        registerName(alice, "alice", "");
        account(MASKED, keccak256("view code commitment"));
        vm.warp(block.timestamp + TERM + 1);

        assertEq(maskedX.getResolver("alice"), address(0));
    }

    function test_anExpiredAccountAnswersInNeitherBranch() public {
        account(b32("alice_x"), bytes32(0));
        vm.warp(block.timestamp + TERM + 1);

        assertEq(publicX.getResolver("alice_x"), address(0));
    }

    function test_reverseAnswersTheBranchTheAccountLivesIn() public {
        account(b32("alice_x"), bytes32(0));

        string memory rev = string.concat(_hex(alice), ".addr.reverse");
        bytes memory out = publicXResolver.resolve(dns(rev), abi.encodeWithSignature("name(bytes32)", node(rev)));
        assertEq(abi.decode(out, (string)), "alice_x.com.x.www.acme-alumni.eth");
    }

    function test_aDomainGetsOneMirrorOnly() public {
        vm.startPrank(operator);
        vm.expectRevert(abi.encodeWithSelector(AttestationFactory.MirrorExists.selector, XCOM));
        factory.createMirror(
            XCOM, INSTANCE, IRegistry(address(privateX)), "com", "com.x.private-www.acme-alumni.eth", inner
        );
        vm.expectRevert(abi.encodeWithSelector(AttestationFactory.UnknownInstance.selector, bytes32("nope")));
        factory.createMirror(
            "nope", INSTANCE, IRegistry(address(privateX)), "com", "com.x.private-www.acme-alumni.eth", inner
        );
        vm.stopPrank();
        assertEq(address(factory.mirror(XCOM).registry), address(maskedX));
        assertEq(address(factory.mirror("nope").registry), address(0));
    }

    function _hex(address a) internal pure returns (string memory) {
        bytes memory h = bytes(Strings.toHexString(a));
        bytes memory out = new bytes(40);
        for (uint256 i; i < 40; ++i) {
            out[i] = h[i + 2];
        }
        return string(out);
    }
}
