// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMultipass} from "@peeramid-labs/multipass/src/interfaces/IMultipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AttestationBridge} from "./AttestationBridge.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/**
 * @notice Writes what a Chainlink CRE enclave signed. The KeystoneForwarder delivers the DON's report
 *         here and this contract hands it to `AttestationBridge.verify`, so the record lands with the
 *         same profile-key grants a browser-submitted record gets and no key of ours is in the path.
 *
 *         It deliberately holds no privileges: `verify` is permissionless and Multipass never reads
 *         `msg.sender`, so an existing bridge needs no migration to gain a DON write path.
 *
 *         A report cannot carry value, so the domain fee is paid from this contract's balance; anyone
 *         may top it up. Every served domain on the current deployment has a zero fee.
 */
contract AttestationReporter is IReceiver {
    /// @notice The only address allowed to deliver reports: the KeystoneForwarder for this chain.
    address public immutable FORWARDER;
    IMultipass public immutable MP;
    AttestationBridge public immutable BRIDGE;

    event Reported(bytes32 indexed id, bytes32 indexed domainName, uint256 fee, bytes metadata);
    event Funded(address indexed from, uint256 amount);

    error UnauthorizedForwarder(address caller);
    error FeeNotFunded(uint256 needed, uint256 balance);

    constructor(address forwarder, IMultipass mp, AttestationBridge bridge) {
        FORWARDER = forwarder;
        MP = mp;
        BRIDGE = bridge;
    }

    /**
     * @param metadata Forwarder-supplied execution metadata; kept in the event for audit.
     * @param report `abi.encode(LibMultipass.Record, bytes registrarSig)`, as the workflow encodes it.
     *
     * A first record goes through the bridge, which also grants the wallet its profile keys. A later
     * one is a renewal: Multipass splits those, `register` reverts with `recordExists`, and renewing
     * needs no privileges, so it goes straight to Multipass and the grants stay as they were.
     */
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != FORWARDER) revert UnauthorizedForwarder(msg.sender);
        (LibMultipass.Record memory rec, bytes memory registrarSig) = abi.decode(report, (LibMultipass.Record, bytes));
        LibMultipass.NameQuery memory query = LibMultipass.NameQuery({
            domainName: rec.domainName, wallet: address(0), name: bytes32(0), id: rec.id, targetDomain: bytes32(0)
        });
        (bool exists,) = MP.resolveRecord(query);
        LibMultipass.Domain memory domain = MP.getDomainState(rec.domainName);
        uint256 fee = exists ? domain.renewalFee : domain.fee;
        if (fee > address(this).balance) revert FeeNotFunded(fee, address(this).balance);
        if (exists) {
            MP.renewRecord{value: fee}(query, rec, registrarSig);
        } else {
            BRIDGE.verify{value: fee}(
                rec,
                registrarSig,
                LibMultipass.NameQuery(bytes32(0), address(0), bytes32(0), bytes32(0), bytes32(0)),
                ""
            );
        }
        emit Reported(rec.id, rec.domainName, fee, metadata);
    }

    /// @notice Anyone may fund the domain fees a report cannot attach.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
