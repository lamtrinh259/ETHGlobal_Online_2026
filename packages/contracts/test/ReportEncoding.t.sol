// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";

/**
 * @notice The seam between the enclave and this contract.
 *
 * The workflow builds the report with a hand-written list of ABI parameters, and `onReport` decodes it
 * as `LibMultipass.Record`. Every field is a fixed 32-byte slot, so a list that drifted out of order
 * would decode without reverting and register a record whose wallet was its name — and both test
 * suites would still pass, because each only ever checks its own side.
 *
 * The vector below is the output of `encodeReport` in packages/cre/attest/workflow.ts for the values
 * asserted here. If either side reorders, one of the two suites fails, which is the point of pinning
 * bytes rather than a shape.
 */
contract ReportEncodingTest is Test {
    bytes internal constant VECTOR = hex"000000000000000000000000ee4811b9462956c9c3535e79c08776d769ca9f3a"
        hex"616c696365000000000000000000000000000000000000000000000000000000"
        hex"3132333435363738393031323334353637383900000000000000000000000000"
        hex"0000000000000000000000000000000000000000000000000000000000000007"
        hex"7800000000000000000000000000000000000000000000000000000000000000"
        hex"000000000000000000000000000000000000000000000000000000006aca5818"
        hex"00000000000000000000000000000000000000000000000000000000000000ff"
        hex"0000000000000000000000000000000000000000000000000000000000000100"
        hex"0000000000000000000000000000000000000000000000000000000000000002"
        hex"1234000000000000000000000000000000000000000000000000000000000000";

    function test_whatTheEnclaveEncodesIsWhatThisContractDecodes() public pure {
        (LibMultipass.Record memory rec, bytes memory sig) = abi.decode(VECTOR, (LibMultipass.Record, bytes));

        assertEq(rec.wallet, 0xEE4811b9462956C9C3535E79c08776D769CA9F3a, "wallet");
        assertEq(rec.name, bytes32(bytes("alice")), "name");
        assertEq(rec.nonce, 7, "nonce");
        assertEq(rec.domainName, bytes32(bytes("x")), "domainName");
        assertEq(rec.validUntil, 1791645720, "validUntil");
        assertEq(rec.payload, bytes32(uint256(0xff)), "payload");
        assertEq(sig, hex"1234", "signature");
    }
}
