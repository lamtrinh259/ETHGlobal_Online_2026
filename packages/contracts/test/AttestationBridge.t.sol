// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {BaseTest} from "./Base.t.sol";

contract AttestationBridgeTest is BaseTest {
    string internal constant NAME = "alice.acme-alumni.eth";

    // ---------- verify ----------

    function test_verify_registersAndGrantsFourTextKeys() public {
        registerName(alice, "alice", "answer");

        (bool ok, LibMultipass.Record memory r) =
            mp.resolveRecord(LibMultipass.NameQuery(INSTANCE, alice, bytes32(0), bytes32(0), bytes32(0)));
        assertTrue(ok);
        assertEq(r.name, b32("alice"));
        assertEq(r.payload, b32("answer"));
        assertEq(r.nonce, 1);
        assertEq(r.validUntil, block.timestamp + TERM);

        string[4] memory keys = ["avatar", "description", "url", "email"];
        for (uint256 i; i < 4; ++i) {
            assertTrue(inner.hasTextGrant(dns(NAME), keys[i], alice), keys[i]);
        }
        assertFalse(inner.hasTextGrant(dns(NAME), "com.twitter", alice));
        assertFalse(inner.hasTextGrant(dns("other.acme-alumni.eth"), "avatar", alice));
    }

    /// @dev The grant is the point, so what it permits and refuses is worth asserting, not just its flag.
    function test_theGrantIsPerKeyAndPerName() public {
        LibMultipass.Record memory r = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("answer"));
        registerVia(alice, r, 0);

        // Her own name, a key the bridge granted: hers to write, and readable through the resolver.
        vm.prank(alice);
        inner.setText(node(NAME), "avatar", "ipfs://cat");
        assertEq(resolveText(NAME, "avatar"), "ipfs://cat");

        // A key nobody granted, on the same name: refused by the resolver, not by this service.
        vm.prank(alice);
        vm.expectRevert();
        inner.setText(node(NAME), "com.twitter", "@someone-else");

        // Somebody else's name, a key that was granted — to them.
        vm.prank(bob);
        vm.expectRevert();
        inner.setText(node(NAME), "avatar", "ipfs://not-yours");
        assertEq(resolveText(NAME, "avatar"), "ipfs://cat");
    }

    function test_verify_platformDomainGrantsNothing() public {
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        registerVia(alice, r, X_FEE);
        assertFalse(inner.hasTextGrant(dns(NAME), "avatar", alice));
        assertFalse(inner.hasTextGrant(dns("alice_x.acme-alumni.eth"), "avatar", alice));
    }

    function test_verify_anyoneCanPayForAnyone() public {
        LibMultipass.Record memory r = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("a"));
        vm.prank(bob);
        bridge.verify(r, signRecord(r), emptyQuery(), "");
        assertEq(registry.getResolver("alice"), address(shim));
        assertTrue(inner.hasTextGrant(dns(NAME), "avatar", alice), "grant goes to the record wallet, not the payer");
    }

    function test_verify_forwardsFeeAndRevertsWhenUnderpaid() public {
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(IMultipass.paymentTooLow.selector, X_FEE, X_FEE - 1));
        bridge.verify{value: X_FEE - 1}(r, signRecord(r), emptyQuery(), "");

        uint256 before = treasury.balance;
        registerVia(alice, r, X_FEE);
        assertEq(treasury.balance - before, X_FEE);
        assertEq(address(bridge).balance, 0);
    }

    function test_verify_badRegistrarSignatureReverts() public {
        LibMultipass.Record memory r = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("a"));
        bytes memory sig = signRecord(r);
        r.payload = b32("tampered");
        vm.prank(alice);
        vm.expectRevert(IMultipass.invalidSignature.selector);
        bridge.verify(r, sig, emptyQuery(), "");
    }

    function test_verify_secondInstanceGetsItsOwnSuffix() public {
        vm.prank(operator);
        factory.create("uni", ethRegistry, "uni", "uni.eth", inner);
        vm.prank(treasury);
        mp.initializeDomain(registrar, 0, 0, "uni", 0, 0);
        vm.prank(treasury);
        mp.activateDomain("uni");

        registerVia(alice, record("uni", alice, b32("prof"), b32("prof-id"), 1, b32("x")), 0);
        assertTrue(inner.hasTextGrant(dns("prof.uni.eth"), "avatar", alice));
        assertFalse(inner.hasTextGrant(dns("prof.acme-alumni.eth"), "avatar", alice));
    }

    // ---------- verifyFor (org sponsorship) ----------

    function _setupOrg(bytes32 orgId, uint256 orgKey) internal returns (address orgWallet) {
        orgWallet = vm.addr(orgKey);
        vm.deal(orgWallet, 10 ether);
        LibMultipass.Record memory o = record(ORG, orgWallet, b32("acme"), b32("acme-id"), 1, bytes32(0));
        registerVia(orgWallet, o, 0);
        vm.prank(operator);
        bridge.setOrg(
            orgId,
            orgWallet,
            LibMultipass.NameQuery(ORG, orgWallet, bytes32(0), bytes32(0), bytes32(0)),
            signReferral(orgKey, orgWallet),
            true
        );
    }

    function test_verifyFor_treasuryPaysAndOrgEarnsReferral() public {
        bytes32 orgId = keccak256("acme");
        address orgWallet = _setupOrg(orgId, 0x0C3E);

        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        uint256 orgBefore = orgWallet.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(orgWallet);
        vm.expectEmit(true, true, false, true, address(bridge));
        emit AttestationBridge.Sponsored(orgId, r.id, r.domainName);
        bridge.verifyFor{value: X_FEE - X_DISCOUNT}(orgId, r, signRecord(r));

        assertEq(orgBefore - orgWallet.balance, X_FEE - X_DISCOUNT - X_REWARD, "org pays discounted fee minus reward");
        assertEq(treasury.balance - treasuryBefore, X_FEE - X_DISCOUNT - X_REWARD);
        assertEq(registry.getResolver("alice_x"), address(0), "platform record is not an ENS name");
        (bool ok,) = mp.resolveRecord(LibMultipass.NameQuery(X, alice, bytes32(0), bytes32(0), bytes32(0)));
        assertTrue(ok);
    }

    function test_verifyFor_grantsTextKeysForInstanceDomain() public {
        bytes32 orgId = keccak256("acme");
        address orgWallet = _setupOrg(orgId, 0x0C3E);
        LibMultipass.Record memory r = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("a"));
        vm.prank(orgWallet);
        bridge.verifyFor(orgId, r, signRecord(r));
        assertTrue(inner.hasTextGrant(dns(NAME), "avatar", alice));
    }

    function test_verifyFor_onlyOrgTreasury() public {
        bytes32 orgId = keccak256("acme");
        _setupOrg(orgId, 0x0C3E);
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AttestationBridge.NotOrgTreasury.selector, orgId, bob));
        bridge.verifyFor{value: X_FEE}(orgId, r, signRecord(r));
    }

    function test_verifyFor_inactiveOrgReverts() public {
        bytes32 orgId = keccak256("acme");
        address orgWallet = _setupOrg(orgId, 0x0C3E);
        vm.prank(operator);
        bridge.setOrg(orgId, orgWallet, emptyQuery(), "", false);
        assertFalse(bridge.org(orgId).active);
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        vm.prank(orgWallet);
        vm.expectRevert(abi.encodeWithSelector(AttestationBridge.NotOrgTreasury.selector, orgId, orgWallet));
        bridge.verifyFor{value: X_FEE}(orgId, r, signRecord(r));
    }

    function test_setOrg_onlyOwner() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        bridge.setOrg(keccak256("x"), bob, emptyQuery(), "", true);
    }

    // ---------- linkOwnName ----------

    function test_linkOwnName_setsAliasForEnsOwner() public {
        registerName(alice, "alice", "a");
        ethRegistry.setLabel("alice", alice, registry, address(0));

        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(bridge));
        emit AttestationBridge.NameLinked(alice, INSTANCE, "alice", dns(NAME));
        bridge.linkOwnName(INSTANCE, "alice");

        assertEq(inner.getAlias(dns("acme-alumni.alice.eth")), dns(NAME));
        assertEq(resolveAddr("acme-alumni.alice.eth"), alice);
    }

    function test_linkOwnName_revertsForNonOwner() public {
        registerName(alice, "alice", "a");
        ethRegistry.setLabel("alice", alice, registry, address(0));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(AttestationBridge.NotNameOwner.selector, "alice", bob));
        bridge.linkOwnName(INSTANCE, "alice");
    }

    function test_linkOwnName_revertsWithoutRecord() public {
        ethRegistry.setLabel("alice", alice, registry, address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AttestationBridge.NoRecord.selector, INSTANCE, alice));
        bridge.linkOwnName(INSTANCE, "alice");
    }

    function test_linkOwnName_revertsForUnknownInstance() public {
        vm.prank(treasury);
        mp.initializeDomain(registrar, 0, 0, "orphan", 0, 0);
        vm.prank(treasury);
        mp.activateDomain("orphan");
        registerVia(alice, record("orphan", alice, b32("alice"), b32("id"), 1, bytes32(0)), 0);
        ethRegistry.setLabel("alice", alice, registry, address(0));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AttestationFactory.UnknownInstance.selector, bytes32("orphan")));
        bridge.linkOwnName("orphan", "alice");
    }
}
