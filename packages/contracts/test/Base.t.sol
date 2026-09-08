// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Multipass} from "@peeramid-labs/multipass/src/Multipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {NameCoder} from "@ens/contracts/utils/NameCoder.sol";
import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {PermissionedResolverRoles as R} from "../src/interfaces/IPermissionedResolver.sol";
import {MockPermissionedResolver} from "./mocks/MockPermissionedResolver.sol";
import {MockEthRegistry} from "./mocks/MockEthRegistry.sol";

/// @dev Shared fixture: real Multipass (test build), mock stock resolver, mock .eth registry,
///      factory + bridge, and one instance (`INSTANCE` domain under `<LABEL>.eth`) wired as the
///      deploy script does. The instance is deliberately not called kju-is: the subject is an argument.
abstract contract BaseTest is Test {
    bytes32 internal constant INSTANCE = "acme-alumni";
    string internal constant LABEL = "acme-alumni";
    string internal constant PARENT = "acme-alumni.eth";
    bytes32 internal constant X = "x";
    bytes32 internal constant HUMANITY = "humanity";
    bytes32 internal constant ORG = "org";
    string internal constant MP_NAME = "MultipassDNS";
    string internal constant MP_VERSION = "1.0.0";
    uint256 internal constant TERM = 30 days;
    uint256 internal constant X_FEE = 0.01 ether;
    uint256 internal constant X_REWARD = 0.002 ether;
    uint256 internal constant X_DISCOUNT = 0.001 ether;

    uint256 internal registrarKey = 0xB0B0;
    address internal registrar = vm.addr(registrarKey);
    address internal operator = makeAddr("operator");
    address internal treasury = makeAddr("treasury");
    uint256 internal aliceKey = 0xA11CE;
    address internal alice = vm.addr(aliceKey);
    address internal bob = makeAddr("bob");

    Multipass internal mp;
    MockPermissionedResolver internal inner;
    MockEthRegistry internal ethRegistry;
    AttestationFactory internal factory;
    AttestationBridge internal bridge;
    AttestationRegistry internal registry;
    AttestationResolver internal shim;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        mp = new Multipass(true);
        mp.initialize(MP_NAME, MP_VERSION, treasury);
        vm.startPrank(treasury);
        mp.initializeDomain(registrar, 0, 0, INSTANCE, 0, 0);
        mp.activateDomain(INSTANCE);
        mp.initializeDomain(registrar, X_FEE, 0, X, X_REWARD, X_DISCOUNT);
        mp.activateDomain(X);
        mp.initializeDomain(registrar, 0, 0, HUMANITY, 0, 0);
        mp.activateDomain(HUMANITY);
        mp.initializeDomain(registrar, 0, 0, ORG, 0, 0);
        mp.activateDomain(ORG);
        vm.stopPrank();

        inner = new MockPermissionedResolver(operator);
        ethRegistry = new MockEthRegistry();
        factory = new AttestationFactory(mp, operator);
        bridge = new AttestationBridge(mp, inner, ethRegistry, factory, operator);

        vm.prank(operator);
        (registry, shim) = factory.create(INSTANCE, IRegistry(address(ethRegistry)), LABEL, PARENT, inner);

        ethRegistry.setLabel(LABEL, operator, registry, address(shim));
        vm.prank(operator);
        inner.grantRootRoles(R.ROLE_SET_TEXT_ADMIN | R.ROLE_SET_ALIAS, address(bridge));
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    // ---------- Multipass helpers ----------

    function b32(string memory s) internal pure returns (bytes32 out) {
        bytes memory b = bytes(s);
        require(b.length <= 31, "b32: too long");
        assembly {
            out := mload(add(b, 32))
        }
    }

    function domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(MP_NAME)),
                keccak256(bytes(MP_VERSION)),
                block.chainid,
                address(mp)
            )
        );
    }

    function signRecord(LibMultipass.Record memory r) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "registerName(bytes32 name,bytes32 id,bytes32 domainName,uint256 validUntil,uint96 nonce,address wallet,bytes32 payload)"
                ),
                r.name,
                r.id,
                r.domainName,
                r.validUntil,
                r.nonce,
                r.wallet,
                r.payload
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(registrarKey, digest);
        return abi.encodePacked(rr, ss, v);
    }

    function signReferral(uint256 key, address referrer) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(keccak256("proofOfReferrer(address referrerAddress)"), referrer));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(key, digest);
        return abi.encodePacked(rr, ss, v);
    }

    function record(bytes32 domain, address wallet, bytes32 name, bytes32 id, uint96 nonce, bytes32 payload)
        internal
        view
        returns (LibMultipass.Record memory)
    {
        return LibMultipass.Record({
            wallet: wallet,
            name: name,
            id: id,
            nonce: nonce,
            domainName: domain,
            validUntil: block.timestamp + TERM,
            payload: payload
        });
    }

    function emptyQuery() internal pure returns (LibMultipass.NameQuery memory q) {}

    /// @dev Register through the bridge as `wallet` with no referrer.
    function registerVia(address wallet, LibMultipass.Record memory r, uint256 value) internal {
        vm.prank(wallet);
        bridge.verify{value: value}(r, signRecord(r), emptyQuery(), "");
    }

    /// @dev Register a name record in the instance domain: handle + answer.
    function registerName(address wallet, string memory handle, string memory answer) internal {
        registerVia(
            wallet,
            record(INSTANCE, wallet, b32(handle), keccak256(abi.encodePacked("did:", handle)), 1, b32(answer)),
            0
        );
    }

    // ---------- ENS helpers ----------

    function dns(string memory name) internal pure returns (bytes memory) {
        return NameCoder.encode(name);
    }

    function node(string memory name) internal pure returns (bytes32) {
        return NameCoder.namehash(NameCoder.encode(name), 0);
    }

    function resolveText(string memory name, string memory key) internal view returns (string memory) {
        bytes memory out = shim.resolve(dns(name), abi.encodeWithSignature("text(bytes32,string)", node(name), key));
        return abi.decode(out, (string));
    }

    function resolveData(string memory name, string memory key) internal view returns (bytes memory) {
        bytes memory out = shim.resolve(dns(name), abi.encodeWithSignature("data(bytes32,string)", node(name), key));
        return abi.decode(out, (bytes));
    }

    function resolveAddr(string memory name) internal view returns (address) {
        bytes memory out = shim.resolve(dns(name), abi.encodeWithSignature("addr(bytes32)", node(name)));
        return abi.decode(out, (address));
    }

    function resolveName(string memory name) internal view returns (string memory) {
        bytes memory out = shim.resolve(dns(name), abi.encodeWithSignature("name(bytes32)", node(name)));
        return abi.decode(out, (string));
    }
}
