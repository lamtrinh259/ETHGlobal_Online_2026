// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {SetInstanceText} from "../script/SetInstanceText.s.sol";
import {IPermissionedResolver, PermissionedResolverRoles as R} from "../src/interfaces/IPermissionedResolver.sol";
import {MockPermissionedResolver} from "./mocks/MockPermissionedResolver.sol";

/// @notice A question is only worth answering if a reader can see what the answer is for.
contract SetInstanceTextTest is Test {
    uint256 internal constant PK = 0xA11CE;
    MockPermissionedResolver internal inner;
    SetInstanceText internal script;

    string internal constant NAME = "kju-is.ketsuban.eth";
    string internal constant WHY =
        "Answering says whether a subject is affiliated with North Korean operators, who will not answer freely.";

    function setUp() public {
        inner = new MockPermissionedResolver(vm.addr(PK));
        script = new SetInstanceText();
    }

    function _run(string memory key, string memory value) internal {
        script.runWith(
            SetInstanceText.Params({
                pk: PK, inner: IPermissionedResolver(address(inner)), name: NAME, key: key, value: value
            })
        );
    }

    function test_writesThePurposeOntoTheInstanceName() public {
        _run("description", WHY);
        assertEq(inner.text(NameCoder.namehash(NameCoder.encode(NAME), 0), "description"), WHY);
    }

    /// @notice The write is made explicit rather than resting on the operator holding a root role: a
    ///         root caller could set this key without a grant today, and would stop being able to the
    ///         moment that role moved.
    function test_leavesThePermissionOnTheNameItWrote() public {
        _run("description", WHY);
        bytes32 node = NameCoder.namehash(NameCoder.encode(NAME), 0);
        bytes32 part = keccak256(abi.encode(node, keccak256(bytes("description")), R.ROLE_SET_TEXT));
        assertTrue(inner.partGrants(part, vm.addr(PK)));
    }

    /// @notice Only the name it was pointed at: a purpose written on the wrong name explains nothing.
    function test_touchesNoOtherName() public {
        _run("description", WHY);
        assertEq(inner.text(NameCoder.namehash(NameCoder.encode("other.ketsuban.eth"), 0), "description"), "");
    }
}
