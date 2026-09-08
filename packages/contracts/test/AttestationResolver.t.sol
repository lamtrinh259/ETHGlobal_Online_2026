// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IExtendedResolver} from "@ens/contracts/resolvers/profiles/IExtendedResolver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {MockPermissionedResolver} from "./mocks/MockPermissionedResolver.sol";
import {BaseTest} from "./Base.t.sol";

contract AttestationResolverTest is BaseTest {
    string internal constant NAME = "alice.acme-alumni.eth";

    function setUp() public override {
        super.setUp();
        registerName(alice, "alice", "terrible dictator");
    }

    // ---------- addr / att:* text ----------

    function test_addr_resolvesToRecordWallet() public view {
        assertEq(resolveAddr(NAME), alice);
    }

    function test_addr_emptyAfterExpiry() public {
        vm.warp(block.timestamp + TERM);
        assertEq(resolveAddr(NAME), address(0));
    }

    function test_addr_unknownHandleIsZero() public view {
        assertEq(resolveAddr("nobody.acme-alumni.eth"), address(0));
    }

    function test_addr_overlongLabelIsZero() public view {
        assertEq(resolveAddr("this-label-is-way-too-long-for-a-bytes32-slot.acme-alumni.eth"), address(0));
    }

    function test_text_answerAndExpiryComeFromMultipass() public view {
        assertEq(resolveText(NAME, "ketsuban:answer"), "terrible dictator");
        assertEq(resolveText(NAME, "ketsuban:expiry"), Strings.toString(block.timestamp + TERM));
    }

    function test_text_answerEmptyAfterExpiry() public {
        vm.warp(block.timestamp + TERM);
        assertEq(resolveText(NAME, "ketsuban:answer"), "");
        assertEq(resolveText(NAME, "ketsuban:expiry"), "");
    }

    // ---------- ketsuban:link:<domain> ----------

    function test_link_publicPlatformRecord() public {
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1234567890"), 1, bytes32(0));
        registerVia(alice, r, X_FEE);

        bytes memory packed = resolveData(NAME, "ketsuban:link:x");
        assertEq(packed, abi.encodePacked(r.name, r.id, r.payload));
        assertEq(packed.length, 96);
    }

    function test_link_optedInRecordCarriesCommitment() public {
        bytes32 commitment = keccak256("viewcode");
        LibMultipass.Record memory r = record(X, alice, bytes32(uint256(0xAB)), bytes32(uint256(0xCD)), 1, commitment);
        registerVia(alice, r, X_FEE);

        bytes memory packed = resolveData(NAME, "ketsuban:link:x");
        (bytes32 name, bytes32 id, bytes32 payload) = abi.decode(abi.encodePacked(packed), (bytes32, bytes32, bytes32));
        assertEq(name, r.name);
        assertEq(id, r.id);
        assertEq(payload, commitment);
    }

    function test_link_emptyWhenNoRecordOrExpired() public {
        assertEq(resolveData(NAME, "ketsuban:link:x").length, 0);
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        registerVia(alice, r, X_FEE);
        vm.warp(block.timestamp + TERM);
        assertEq(resolveData(NAME, "ketsuban:link:x").length, 0);
    }

    function test_link_isWalletKeyedNotLabelKeyed() public {
        LibMultipass.Record memory r = record(X, bob, b32("bob_x"), b32("2"), 1, bytes32(0));
        registerVia(bob, r, X_FEE);
        assertEq(resolveData(NAME, "ketsuban:link:x").length, 0, "bob's x record must not leak under alice's name");
    }

    function test_link_malformedKeysFallThroughToInner() public {
        vm.prank(operator);
        inner.setData(node(NAME), "ketsuban:link:", hex"01");
        assertEq(resolveData(NAME, "ketsuban:link:"), hex"01");
        assertEq(resolveData(NAME, "ketsuban:link:this-domain-name-is-longer-than-31-bytes").length, 0);
    }

    // ---------- ketsuban:humanity ----------

    function test_humanity_levelFromPayload() public {
        LibMultipass.Record memory h = record(HUMANITY, alice, bytes32(0), keccak256("nullifier"), 1, b32("medium"));
        registerVia(alice, h, 0);
        assertEq(resolveText(NAME, "ketsuban:humanity"), "medium");
        assertEq(resolveText(NAME, "ketsuban:humanity:until"), Strings.toString(block.timestamp + TERM));
    }

    function test_humanity_emptyWhenAbsent() public view {
        assertEq(resolveText(NAME, "ketsuban:humanity"), "");
        assertEq(resolveText(NAME, "ketsuban:humanity:until"), "");
    }

    // ---------- forwarding to the stock resolver ----------

    function test_userTextRecordForwardedToInner() public {
        vm.prank(alice);
        inner.setText(node(NAME), "avatar", "ipfs://pig");
        assertEq(resolveText(NAME, "avatar"), "ipfs://pig");
    }

    function test_unauthorizedUserCannotWriteInner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(MockPermissionedResolver.Unauthorized.selector, bob, 1 << 4));
        inner.setText(node(NAME), "avatar", "ipfs://bob");
    }

    function test_oracleDataKeysForwardedToInner() public {
        vm.prank(operator);
        inner.setData(node(NAME), "ketsuban:polarity", abi.encode(int256(-8e17)));
        assertEq(abi.decode(resolveData(NAME, "ketsuban:polarity"), (int256)), -8e17);
    }

    function test_innerRevertPropagates() public {
        bytes memory data = abi.encodeWithSignature("contenthash(bytes32)", node(NAME));
        vm.expectRevert(
            abi.encodeWithSelector(MockPermissionedResolver.UnsupportedResolverProfile.selector, bytes4(data))
        );
        shim.resolve(dns(NAME), data);
    }

    // ---------- aliasing ----------

    function test_aliasIsAppliedBeforeParsing() public {
        vm.prank(operator);
        inner.setAlias(dns("acme.alice.eth"), dns(NAME));
        assertEq(resolveAddr("acme.alice.eth"), alice);
        assertEq(resolveText("acme.alice.eth", "ketsuban:answer"), "terrible dictator");
    }

    // ---------- reverse ----------

    function test_reverse_nameForWallet() public view {
        assertEq(resolveName(string.concat(_hex(alice), ".addr.reverse")), NAME);
    }

    function test_reverse_emptyForUnknownOrExpiredWallet() public {
        assertEq(resolveName(string.concat(_hex(bob), ".addr.reverse")), "");
        vm.warp(block.timestamp + TERM);
        assertEq(resolveName(string.concat(_hex(alice), ".addr.reverse")), "");
    }

    function test_reverse_emptyForMalformedLabel() public view {
        assertEq(resolveName("nothex.addr.reverse"), "");
        assertEq(resolveName("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.addr.reverse"), "");
    }

    // ---------- metadata ----------

    function test_supportsInterface() public view {
        assertTrue(shim.supportsInterface(type(IExtendedResolver).interfaceId));
        assertTrue(shim.supportsInterface(type(IERC165).interfaceId));
        assertFalse(shim.supportsInterface(0xdeadbeef));
    }

    function test_parentNameAndDomain() public view {
        assertEq(shim.parentName(), PARENT);
        assertEq(shim.DOMAIN(), INSTANCE);
    }

    function _hex(address a) internal pure returns (string memory) {
        bytes memory s = bytes(Strings.toHexString(a));
        bytes memory out = new bytes(40);
        for (uint256 i; i < 40; ++i) {
            out[i] = s[i + 2];
        }
        return string(out);
    }
}
