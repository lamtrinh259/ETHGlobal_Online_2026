import { parseAbi, type Abi } from "viem";
import errors from "@ketsuban/contracts/errors" with { type: "json" };

/**
 * Every custom error in the deployment, generated from the compiled artifacts. viem can only decode a
 * revert it finds in the ABI it was handed, and the error that fires usually belongs to a contract
 * further down the call: Multipass, the resolver, OpenZeppelin. Merging this into each ABI means a
 * revert arrives as `invalidSignature()` rather than as `0xd1cc1202`.
 */
export const errorsAbi = errors as Abi;

/** An ABI that can decode any revert this deployment can produce. */
const withErrors = <T extends readonly unknown[]>(abi: T) => [...abi, ...errorsAbi] as unknown as T;

export const bridgeAbi = withErrors(
  parseAbi([
    "struct Record { address wallet; bytes32 name; bytes32 id; uint96 nonce; bytes32 domainName; uint256 validUntil; bytes32 payload; }",
    "struct NameQuery { bytes32 domainName; address wallet; bytes32 name; bytes32 id; bytes32 targetDomain; }",
    "function verify(Record rec, bytes registrarSig, NameQuery referrer, bytes referralCode) payable",
    "function verifyFor(bytes32 orgId, Record rec, bytes registrarSig) payable",
    "function linkOwnName(bytes32 domain, string label)",
    "event Sponsored(bytes32 indexed orgId, bytes32 indexed id, bytes32 domainName)",
  ])
);

export const factoryAbi = withErrors(
  parseAbi([
    "struct Instance { address registry; address resolver; address parent; string parentLabel; string parentName; }",
    "function instance(bytes32 domain) view returns (Instance)",
    "function domains() view returns (bytes32[])",
    "function isInstance(bytes32 domain) view returns (bool)",
    "function create(bytes32 domain, address parent, string parentLabel, string parentName, address inner) returns (address registry, address resolver)",
    "function mirror(bytes32 domain) view returns (Instance)",
  ])
);

export const registryAbi = withErrors(
  parseAbi([
    "function setSubregistry(string label, address sub)",
    "function getSubregistry(string label) view returns (address)",
  ])
);

export const resolverAbi = withErrors(
  parseAbi([
    "function resolve(bytes name, bytes data) view returns (bytes)",
    "function addr(bytes32 node) view returns (address)",
    "function text(bytes32 node, string key) view returns (string)",
    "function data(bytes32 node, string key) view returns (bytes)",
    "function name(bytes32 node) view returns (string)",
  ])
);

/// ENSv2 UniversalResolver: walks the registry to the resolver that owns a name and calls it.
export const universalResolverAbi = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes result, address resolver)",
]);
