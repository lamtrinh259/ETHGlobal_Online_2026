// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AttestationReporter} from "../src/AttestationReporter.sol";
import {BaseTest} from "./Base.t.sol";

/// @dev The DON write path: a report from the KeystoneForwarder lands as a Multipass record.
contract AttestationReporterTest is BaseTest {
    string internal constant NAME = "alice.acme-alumni.eth";

    function test_onReport_registersWhatTheEnclaveSigned() public {
        LibMultipass.Record memory r = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("answer"));
        bytes memory report = abi.encode(r, signRecord(r));

        vm.expectEmit(true, true, false, true, address(reporter));
        emit AttestationReporter.Reported(r.id, INSTANCE, 0, hex"beef");
        vm.prank(forwarder);
        reporter.onReport(hex"beef", report);

        (bool ok, LibMultipass.Record memory stored) =
            mp.resolveRecord(LibMultipass.NameQuery(INSTANCE, alice, bytes32(0), bytes32(0), bytes32(0)));
        assertTrue(ok);
        assertEq(stored.payload, b32("answer"));
        assertTrue(inner.hasTextGrant(dns(NAME), "avatar", alice), "the record wallet gets its profile keys");
    }

    function test_onReport_onlyTheForwarderMayDeliver() public {
        LibMultipass.Record memory r = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("answer"));
        bytes memory report = abi.encode(r, signRecord(r));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(AttestationReporter.UnauthorizedForwarder.selector, alice));
        reporter.onReport("", report);
    }

    function test_onReport_paysTheDomainFeeFromItsOwnBalance() public {
        LibMultipass.Record memory r = record(X, alice, b32("alice_x"), b32("1"), 1, bytes32(0));
        bytes memory report = abi.encode(r, signRecord(r));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(AttestationReporter.FeeNotFunded.selector, X_FEE, 0));
        reporter.onReport("", report);

        vm.deal(bob, 1 ether);
        vm.expectEmit(true, false, false, true, address(reporter));
        emit AttestationReporter.Funded(bob, X_FEE * 2);
        vm.prank(bob);
        (bool sent,) = address(reporter).call{value: X_FEE * 2}("");
        assertTrue(sent);

        uint256 treasuryBefore = treasury.balance;
        vm.prank(forwarder);
        reporter.onReport("", report);
        assertEq(treasury.balance - treasuryBefore, X_FEE, "the fee reaches the Multipass owner");
        assertEq(address(reporter).balance, X_FEE, "the rest stays for the next report");

        (bool ok,) = mp.resolveRecord(LibMultipass.NameQuery(X, alice, bytes32(0), bytes32(0), bytes32(0)));
        assertTrue(ok);
    }


    function test_onReport_renewsWhenTheRecordAlreadyExists() public {
        LibMultipass.Record memory first = record(INSTANCE, alice, b32("alice"), b32("id"), 1, b32("first"));
        vm.prank(forwarder);
        reporter.onReport("", abi.encode(first, signRecord(first)));

        LibMultipass.Record memory second = record(INSTANCE, alice, b32("alice"), b32("id"), 2, b32("second"));
        vm.prank(forwarder);
        reporter.onReport("", abi.encode(second, signRecord(second)));

        (bool ok, LibMultipass.Record memory stored) =
            mp.resolveRecord(LibMultipass.NameQuery(INSTANCE, alice, bytes32(0), bytes32(0), bytes32(0)));
        assertTrue(ok);
        assertEq(stored.payload, b32("second"));
        assertEq(stored.nonce, 2);
    }

    function test_constructor_exposesItsWiring() public view {
        assertEq(reporter.FORWARDER(), forwarder);
        assertEq(address(reporter.MP()), address(mp));
        assertEq(address(reporter.BRIDGE()), address(bridge));
    }
}
