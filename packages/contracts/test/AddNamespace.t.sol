// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IRegistry} from "@ensv2/registry/IRegistry.sol";
import {Multipass} from "@peeramid-labs/multipass/src/Multipass.sol";
import {LibMultipass} from "@peeramid-labs/multipass/src/libraries/LibMultipass.sol";
import {AddNamespace} from "../script/AddNamespace.s.sol";
import {AttestationFactory} from "../src/AttestationFactory.sol";
import {AttestationRegistry} from "../src/AttestationRegistry.sol";
import {AttestationResolver} from "../src/AttestationResolver.sol";
import {AttestationBridge} from "../src/AttestationBridge.sol";
import {GroupingRegistry} from "../src/GroupingRegistry.sol";
import {PermissionedResolverRoles as R} from "../src/interfaces/IPermissionedResolver.sol";
import {MockPermissionedResolver} from "./mocks/MockPermissionedResolver.sol";
import {MockEthRegistry} from "./mocks/MockEthRegistry.sol";
import {BaseTest} from "./Base.t.sol";

/**
 * The deployment script is the only thing that will ever build this namespace on a live chain, so it is
 * the thing worth testing: one operator key, a list of DNS names, and every level, instance and mirror
 * mounted so an attested account resolves.
 */
contract AddNamespaceTest is BaseTest {
    uint256 internal constant OPERATOR_KEY = 0x0FE7A;

    AddNamespace internal script;
    address internal deployer = vm.addr(OPERATOR_KEY);

    Multipass internal mp2;
    MockPermissionedResolver internal inner2;
    AttestationFactory internal factory2;
    AttestationBridge internal bridge2;
    AttestationRegistry internal root2;

    function setUp() public override {
        super.setUp();
        // A fixture the script's own key owns: it initialises Multipass domains and mounts registries.
        vm.startPrank(deployer);
        mp2 = new Multipass(true);
        mp2.initialize(MP_NAME, MP_VERSION, deployer);
        mp2.initializeDomain(registrar, 0, 0, INSTANCE, 0, 0);
        mp2.activateDomain(INSTANCE);
        inner2 = new MockPermissionedResolver(deployer);
        MockEthRegistry eth2 = new MockEthRegistry();
        factory2 = new AttestationFactory(mp2, deployer);
        bridge2 = new AttestationBridge(mp2, inner2, eth2, factory2, deployer);
        (root2,) = factory2.create(INSTANCE, IRegistry(address(eth2)), LABEL, PARENT, inner2);
        eth2.setLabel(LABEL, deployer, root2, address(0));
        inner2.grantRootRoles(R.ROLE_SET_TEXT_ADMIN | R.ROLE_SET_ALIAS, address(bridge2));
        vm.stopPrank();

        script = new AddNamespace();
        script.runWith(params(list("x.com", "tenant.acme.com"), list("peeramid.xyz", "")));
    }

    /// @dev The script's inputs, handed over rather than exported: forge runs suites in parallel and
    ///      they share one environment, so a test that sets variables races every other one.
    function params(string[] memory www, string[] memory at) internal view returns (AddNamespace.Params memory) {
        return AddNamespace.Params({
            pk: OPERATOR_KEY,
            factory: factory2,
            root: root2,
            mp: mp2,
            inner: inner2,
            registrar: registrar,
            rootParent: PARENT,
            rootDomain: bytes32(bytes(LABEL)),
            wwwNames: www,
            atNames: at
        });
    }

    function list(string memory a, string memory b) internal pure returns (string[] memory out) {
        out = bytes(b).length == 0 ? new string[](1) : new string[](2);
        out[0] = a;
        if (bytes(b).length > 0) out[1] = b;
    }

    /// @dev Register through the second fixture's bridge, which is what the API would do.
    function write(bytes32 domain, address wallet, bytes32 name, bytes32 payload) internal {
        LibMultipass.Record memory r = LibMultipass.Record({
            wallet: wallet,
            name: name,
            id: keccak256(abi.encodePacked(domain, name)),
            nonce: 1,
            domainName: domain,
            validUntil: block.timestamp + TERM,
            payload: payload
        });
        vm.prank(wallet);
        bridge2.verify(r, signRecordOn(mp2, r), emptyQuery(), "");
    }

    function resolverFor(string memory dns, bool masked) internal view returns (AttestationResolver) {
        AttestationFactory.Instance memory open = factory2.instance(bytes32(bytes(dns)));
        return masked ? factory2.mirror(bytes32(bytes(dns))).resolver : open.resolver;
    }

    function test_readsTheDeploymentFileWhenNoAddressesAreGiven() public {
        // A local run has just written the file the API reads; naming it beats repeating six addresses.
        string memory file = "deployments/test-namespace.json";
        string memory json = "deployment";
        vm.serializeAddress(json, "factory", address(factory2));
        vm.serializeAddress(json, "registry", address(root2));
        vm.serializeAddress(json, "multipass", address(mp2));
        vm.serializeAddress(json, "permissionedResolver", address(inner2));
        vm.serializeString(json, "instanceDomain", LABEL);
        vm.writeJson(vm.serializeString(json, "instanceParent", PARENT), file);

        // The only test that goes through the environment, because that is the path it is testing.
        vm.setEnv("DEPLOYMENT_FILE", file);
        vm.setEnv("PRIVATE_KEY", vm.toString(OPERATOR_KEY));
        vm.setEnv("REGISTRAR", vm.toString(registrar));
        for (uint256 i; i < 4; ++i) {
            vm.setEnv(["FACTORY", "REGISTRY", "MULTIPASS", "PERMISSIONED_RESOLVER"][i], "");
        }
        vm.setEnv("ROOT_PARENT", "");
        vm.setEnv("ROOT_DOMAIN", "");
        vm.setEnv("WWW_NAMES", "reddit.com");
        vm.setEnv("AT_NAMES", "");

        script.run();
        vm.setEnv("DEPLOYMENT_FILE", "");
        assertEq(factory2.parentNameOf("reddit.com"), "com.reddit.www.acme-alumni.eth");
        vm.removeFile(file);
    }

    function test_everyLevelIsMountedAndReused() public {
        IRegistry www = root2.getSubregistry("www");
        assertTrue(address(www) != address(0), "www");
        IRegistry x = www.getSubregistry("x");
        assertEq(address(x.getSubregistry("com")), address(factory2.instance("x.com").registry));
        // A subdomain keeps its own chain, so acme.com's accounts and tenant.acme.com's never mix.
        IRegistry tenant = www.getSubregistry("tenant");
        assertEq(
            address(tenant.getSubregistry("acme").getSubregistry("com")),
            address(factory2.instance("tenant.acme.com").registry)
        );
        // The at-sign level is separate, and both branches of it exist.
        assertTrue(address(root2.getSubregistry(unicode"@")) != address(0), "at");
        assertTrue(address(root2.getSubregistry("private-www")) != address(0), "private-www");
        assertTrue(address(root2.getSubregistry(unicode"private@")) != address(0), "private at");

        // Re-running adds nothing: the levels and instances are found, not rebuilt.
        address before = address(factory2.instance("x.com").registry);
        script.runWith(params(list("x.com", "tenant.acme.com"), list("peeramid.xyz", "")));
        assertEq(address(factory2.instance("x.com").registry), before);
        assertEq(address(www.getSubregistry("x")), address(x));
    }

    function test_anAccountResolvesAtItsDnsName() public {
        write("x.com", alice, b32("alice_x"), bytes32(0));
        assertEq(addrOf(resolverFor("x.com", false), "alice_x.com.x.www.acme-alumni.eth"), alice);
        assertEq(factory2.parentNameOf("x.com"), "com.x.www.acme-alumni.eth");
        assertEq(factory2.parentNameOf("tenant.acme.com"), "com.acme.tenant.www.acme-alumni.eth");
    }

    function test_anEmailResolvesUnderTheAtSign() public {
        write("peeramid.xyz", alice, b32("tim"), bytes32(0));
        assertEq(addrOf(resolverFor("peeramid.xyz", false), unicode"tim.xyz.peeramid.@.acme-alumni.eth"), alice);
        assertEq(factory2.parentNameOf("peeramid.xyz"), unicode"xyz.peeramid.@.acme-alumni.eth");
    }

    function test_aMaskedAccountResolvesUnderThePersonsName() public {
        write(INSTANCE, alice, b32("alice"), bytes32(0));
        write("x.com", alice, bytes32(bytes31(keccak256("masked"))), keccak256("commitment"));

        assertEq(addrOf(resolverFor("x.com", true), "alice.com.x.private-www.acme-alumni.eth"), alice);
        // The open branch stays silent about it: the account's own name is a pad over the handle.
        assertEq(factory2.instance("x.com").registry.getResolver("alice"), address(0));
    }

    function addrOf(AttestationResolver r, string memory name) internal view returns (address) {
        bytes memory out = r.resolve(dns(name), abi.encodeWithSignature("addr(bytes32)", node(name)));
        return abi.decode(out, (address));
    }

    /// @dev BaseTest signs for its own Multipass; the script's fixture is a different verifying contract.
    function signRecordOn(Multipass target, LibMultipass.Record memory r) internal view returns (bytes memory) {
        bytes32 separator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(MP_NAME)),
                keccak256(bytes(MP_VERSION)),
                block.chainid,
                address(target)
            )
        );
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
        (uint8 v, bytes32 rr, bytes32 ss) =
            vm.sign(registrarKey, keccak256(abi.encodePacked("\x19\x01", separator, structHash)));
        return abi.encodePacked(rr, ss, v);
    }
}
