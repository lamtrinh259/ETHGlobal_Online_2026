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

    // ---------- submitRecord: register, then renew ----------

    function test_submitRecord_registersThenRenews() public {
        LibMultipass.Record memory first = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("first"));
        vm.prank(alice);
        bridge.submitRecord(first, signRecord(first));

        (bool ok, LibMultipass.Record memory stored) =
            mp.resolveRecord(LibMultipass.NameQuery(INSTANCE, alice, bytes32(0), bytes32(0), bytes32(0)));
        assertTrue(ok);
        assertEq(stored.payload, b32("first"));
        assertTrue(inner.hasTextGrant(dns(NAME), "avatar", alice));

        // The second write for the same id must renew: `register` would revert with recordExists.
        LibMultipass.Record memory second = record(INSTANCE, alice, b32("alice"), b32("id"), 2, b32("second"));
        vm.prank(alice);
        bridge.submitRecord(second, signRecord(second));

        (, stored) = mp.resolveRecord(LibMultipass.NameQuery(INSTANCE, alice, bytes32(0), bytes32(0), bytes32(0)));
        assertEq(stored.payload, b32("second"), "the live statement is the newest one");
        assertEq(stored.nonce, 2);
    }

    function test_submitRecord_chargesRegistrationThenRenewalFee() public {
        LibMultipass.Record memory first = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        assertEq(bridge.feeFor(first), X_FEE, "a first write costs the registration fee");

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        bridge.submitRecord{value: X_FEE}(first, signRecord(first));

        LibMultipass.Record memory second = record(X, alice, b32("alice_x"), b32("1"), 2, bytes32(0));
        uint256 renewal = bridge.feeFor(second);
        uint256 before = treasury.balance;
        vm.prank(alice);
        bridge.submitRecord{value: renewal}(second, signRecord(second));
        assertEq(treasury.balance - before, renewal, "a renewal costs the renewal fee");
    }

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
