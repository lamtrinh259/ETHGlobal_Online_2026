// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IPermissionedResolver} from "../src/interfaces/IPermissionedResolver.sol";

/**
 * Say what a subject instance is for, on the instance's own name.
 *
 * A question is only worth answering if a reader knows what the answer is for. `kju-is` asks what
 * someone thinks of Kim Jong Un, and the point is not the opinion: a verifier uses it to test whether
 * a subject is affiliated with North Korean operators, who will not answer it freely. Putting that on
 * the name means any ENS client can read the purpose beside the answers, without this app.
 *
 * The operator holds the resolver, so it grants itself the role for this key and then writes.
 *
 *   PERMISSIONED_RESOLVER=0x… NAME=kju-is.ketsuban.eth KEY=description \
 *   VALUE="…" PRIVATE_KEY=$OPERATOR_KEY \
 *   forge script script/SetInstanceText.s.sol --rpc-url $RPC --broadcast
 */
contract SetInstanceText is Script {
    struct Params {
        uint256 pk;
        IPermissionedResolver inner;
        string name;
        string key;
        string value;
    }

    function run() external {
        runWith(
            Params({
                pk: vm.envUint("PRIVATE_KEY"),
                inner: IPermissionedResolver(vm.envAddress("PERMISSIONED_RESOLVER")),
                name: vm.envString("NAME"),
                key: vm.envString("KEY"),
                value: vm.envString("VALUE")
            })
        );
    }

    /// @notice The same work from values a caller already holds, so a test need not export them.
    function runWith(Params memory p) public {
        bytes memory encoded = NameCoder.encode(p.name);
        address operator = vm.addr(p.pk);

        vm.startBroadcast(p.pk);
        // The resolver refuses a key this wallet holds no role for, so grant it before writing.
        p.inner.authorizeTextRoles(encoded, p.key, operator, true);
        p.inner.setText(NameCoder.namehash(encoded, 0), p.key, p.value);
        vm.stopBroadcast();

        console.log("set", p.key, "on", p.name);
    }
}
