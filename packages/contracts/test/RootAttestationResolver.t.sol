// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAddrResolver} from "@ens/contracts/resolvers/profiles/IAddrResolver.sol";
import {ITextResolver} from "@ens/contracts/resolvers/profiles/ITextResolver.sol";
import {INameResolver} from "@ens/contracts/resolvers/profiles/INameResolver.sol";
import {IDataResolver} from "@ens/contracts/resolvers/profiles/IDataResolver.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {MockPermissionedResolver} from "./mocks/MockPermissionedResolver.sol";
import {RootAttestationResolver} from "../src/RootAttestationResolver.sol";
import {BaseTest} from "./Base.t.sol";

/// @dev One resolver at the root answers the whole tree from Multipass. The tree it answers for is
///      exactly the set of Multipass domains, read through the name's path — and nothing else, which is
///      what the per-mount registries were deployed to guarantee.
contract RootAttestationResolverTest is BaseTest {
    bytes32 internal constant SUBJECT = "kju-is";
    bytes32 internal constant VOUCH_ALICE = "~alice";
    bytes32 internal constant XCOM = "x.com";

    RootAttestationResolver internal root;

    function setUp() public override {
        super.setUp();
        vm.startPrank(treasury);
        mp.initializeDomain(registrar, 0, 0, SUBJECT, 0, 0);
        mp.activateDomain(SUBJECT);
        mp.initializeDomain(registrar, 0, 0, VOUCH_ALICE, 0, 0);
        mp.activateDomain(VOUCH_ALICE);
        mp.initializeDomain(registrar, 0, 0, XCOM, 0, 0);
        mp.activateDomain(XCOM);
        vm.stopPrank();
        root = new RootAttestationResolver(mp, inner, INSTANCE, PARENT);

        // alice holds her name, answered the subject, and holds a public account on x.com;
        // bob wrote a reference for her.
        registerVia(alice, record(INSTANCE, alice, b32("alice"), b32("alice-id"), 1, bytes32(0)), 0);
        registerVia(alice, record(SUBJECT, alice, b32("alice"), b32("alice-kju"), 1, b32("dictator")), 0);
        registerVia(bob, record(VOUCH_ALICE, bob, b32("bob"), b32("bob>alice"), 1, b32("great colleague")), 0);
        registerVia(alice, record(XCOM, alice, b32("alice_x"), b32("x-12345"), 1, bytes32(0)), 0);
    }

    function _addr(string memory name) internal view returns (address) {
        bytes memory out = root.resolve(dns(name), abi.encodeWithSelector(IAddrResolver.addr.selector, bytes32(0)));
        return abi.decode(out, (address));
    }

    function _text(string memory name, string memory key) internal view returns (string memory) {
        bytes memory out = root.resolve(dns(name), abi.encodeWithSelector(ITextResolver.text.selector, bytes32(0), key));
        return abi.decode(out, (string));
    }

    function test_rootName_resolvesFromTheRootDomain() public view {
        assertEq(_addr("alice.acme-alumni.eth"), alice);
        assertEq(_addr("nobody.acme-alumni.eth"), address(0));
    }

    function test_subject_resolvesFromItsOwnDomain() public view {
        assertEq(_addr("alice.kju-is.acme-alumni.eth"), alice);
        assertEq(_text("alice.kju-is.acme-alumni.eth", "ketsuban:answer"), "dictator");
    }

    function test_reference_resolvesFromTheCandidatesVouchDomain() public view {
        assertEq(_addr("bob.alice.acme-alumni.eth"), bob);
        assertEq(_text("bob.alice.acme-alumni.eth", "ketsuban:answer"), "great colleague");
    }

    function test_platformAccount_resolvesThroughTheDnsPath() public view {
        assertEq(_addr("alice_x.com.x.www.acme-alumni.eth"), alice);
    }

    function test_unknownPath_answersNothing_neverTheRootName() public view {
        // The failure the per-mount registries existed to prevent: a name under a level the tree does
        // not have must not fall back to `alice`.
        assertEq(_addr("alice.anything.acme-alumni.eth"), address(0));
        assertEq(_addr("alice.com.evil.www.acme-alumni.eth"), address(0));
        assertEq(_addr("alice.com.x.nowhere.acme-alumni.eth"), address(0));
        assertEq(_addr("alice.x.www.acme-alumni.eth"), address(0));
        assertEq(_addr("alice.other.eth"), address(0));
    }

    function test_maskedBranch_saysOnlyThatThePersonHoldsAnAccountThere() public {
        // Nothing masked yet: the private branch answers nothing for alice on x.com.
        assertEq(_addr("alice.com.x.private-www.acme-alumni.eth"), address(0));
        // A masked record: an unreadable name and a commitment in the payload.
        vm.prank(treasury);
        mp.initializeDomain(registrar, 0, 0, "y.com", 0, 0);
        vm.prank(treasury);
        mp.activateDomain("y.com");
        registerVia(alice, record("y.com", alice, keccak256("pad"), keccak256("id"), 1, keccak256("viewcode")), 0);
        assertEq(_addr("alice.com.y.private-www.acme-alumni.eth"), alice);
        // The answer key is never read through the masked branch: the account stays behind the code.
        assertEq(_text("alice.com.y.private-www.acme-alumni.eth", "ketsuban:answer"), "");
        // And the open branch of the same domain does not name the masked account.
        assertEq(_addr("alice.com.y.www.acme-alumni.eth"), address(0));
    }

    function test_humanity_hopsByWalletFromAnyName() public {
        registerVia(alice, record(HUMANITY, alice, bytes32(0), keccak256("human"), 1, b32("selfie")), 0);
        assertEq(_text("alice.acme-alumni.eth", "ketsuban:humanity"), "selfie");
        assertEq(_text("alice.kju-is.acme-alumni.eth", "ketsuban:humanity"), "selfie");
        assertEq(_text("bob.alice.acme-alumni.eth", "ketsuban:humanity"), "");
    }

    function test_expiry_endsAnAnswer() public {
        vm.warp(block.timestamp + TERM + 1);
        assertEq(_addr("alice.acme-alumni.eth"), address(0));
        assertEq(_text("bob.alice.acme-alumni.eth", "ketsuban:answer"), "");
    }

    function test_reverse_isTheRootName() public view {
        bytes memory out = root.resolve(
            dns(string.concat(_hex(alice), ".addr.reverse")),
            abi.encodeWithSelector(INameResolver.name.selector, bytes32(0))
        );
        assertEq(abi.decode(out, (string)), "alice.acme-alumni.eth");
    }

    function test_locate_readsTheTreeFromMultipass() public view {
        RootAttestationResolver.Where memory at = root.locate(dns("bob.alice.acme-alumni.eth"));
        assertTrue(at.known);
        assertEq(at.domain, VOUCH_ALICE);
        assertEq(at.label, b32("bob"));
        assertFalse(at.masked);
        at = root.locate(dns("alice.com.x.private-www.acme-alumni.eth"));
        assertTrue(at.known);
        assertEq(at.domain, XCOM);
        assertTrue(at.masked);
        at = root.locate(dns("alice.anything.acme-alumni.eth"));
        assertFalse(at.known);
    }

    // ---------- everything else is the stock resolver's, exactly as today ----------

    function _data(string memory name, string memory key) internal view returns (bytes memory) {
        bytes memory out = root.resolve(dns(name), abi.encodeWithSelector(IDataResolver.data.selector, bytes32(0), key));
        return abi.decode(out, (bytes));
    }

    function test_userTextRecords_forwardedByFullName_atEveryDepth() public {
        // The bridge grants ROLE_SET_TEXT on the four profile keys of a name's node; the node is the
        // full name's namehash, which does not care which resolver forwarded the read.
        vm.prank(alice);
        inner.setText(node("alice.acme-alumni.eth"), "avatar", "ipfs://pig");
        assertEq(_text("alice.acme-alumni.eth", "avatar"), "ipfs://pig");
        // The grant is the bridge's job at registration; here it is given by hand, on the name's node.
        vm.prank(operator);
        inner.authorizeTextRoles(dns("bob.alice.acme-alumni.eth"), "description", bob, true);
        vm.prank(bob);
        inner.setText(node("bob.alice.acme-alumni.eth"), "description", "we shipped two launches");
        assertEq(_text("bob.alice.acme-alumni.eth", "description"), "we shipped two launches");
        vm.prank(operator);
        inner.authorizeTextRoles(dns("alice_x.com.x.www.acme-alumni.eth"), "url", alice, true);
        vm.prank(alice);
        inner.setText(node("alice_x.com.x.www.acme-alumni.eth"), "url", "https://x.com/alice_x");
        assertEq(_text("alice_x.com.x.www.acme-alumni.eth", "url"), "https://x.com/alice_x");
    }

    function test_rolePermissions_areTheInnerResolvers_untouched() public {
        // Roles live on the PermissionedResolver: a wallet without the grant cannot write, whatever
        // resolver sits in front.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MockPermissionedResolver.Unauthorized.selector, bob, 1 << 4));
        inner.setText(node("alice.acme-alumni.eth"), "avatar", "ipfs://bob");
    }

    function test_oracleDataKeys_forwardedToInner() public {
        vm.prank(operator);
        inner.setData(node("alice.kju-is.acme-alumni.eth"), "ketsuban:polarity", abi.encode(int256(-8e17)));
        assertEq(abi.decode(_data("alice.kju-is.acme-alumni.eth", "ketsuban:polarity"), (int256)), -8e17);
    }

    function test_innerRevertPropagates() public {
        bytes memory data = abi.encodeWithSignature("contenthash(bytes32)", node("alice.acme-alumni.eth"));
        vm.expectRevert(
            abi.encodeWithSelector(MockPermissionedResolver.UnsupportedResolverProfile.selector, bytes4(data))
        );
        root.resolve(dns("alice.acme-alumni.eth"), data);
    }

    function test_aliasIsAppliedBeforeLocating() public {
        vm.prank(operator);
        inner.setAlias(dns("acme.alice.eth"), dns("alice.kju-is.acme-alumni.eth"));
        assertEq(_addr("acme.alice.eth"), alice);
        assertEq(_text("acme.alice.eth", "ketsuban:answer"), "dictator");
    }

    function test_subjectsOwnRecords_areTheMountsName_unchanged() public {
        // A subject's description and picture hang on the mount's own name, a level the operator
        // writes; read through the root the same way, since it is one more name under it.
        vm.prank(operator);
        inner.setText(node("kju-is.acme-alumni.eth"), "description", "Supreme Leader");
        assertEq(_text("kju-is.acme-alumni.eth", "description"), "Supreme Leader");
    }

    function _hex(address a) internal pure returns (string memory) {
        bytes memory raw = abi.encodePacked(a);
        bytes memory out = new bytes(40);
        bytes16 digits = "0123456789abcdef";
        for (uint256 i; i < 20; ++i) {
            out[2 * i] = digits[uint8(raw[i]) >> 4];
            out[2 * i + 1] = digits[uint8(raw[i]) & 0x0f];
        }
        return string(out);
    }
}
