import { createPublicClient, http, encodeFunctionData, parseAbi, zeroAddress, zeroHash, keccak256, concatHex, toHex, decodeErrorResult } from "viem";
import errors from "@ketsuban/contracts/errors" with { type: "json" };
const pub = createPublicClient({ transport: http(process.env.RPC_URL) });
const abi = parseAbi(["function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)"]);
const owner = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const combos = [
  ["sub0-res1", "ketsuban-demo-a", zeroAddress, process.env.PERMISSIONED_RESOLVER],
  ["sub1-res0", "ketsuban-demo-b", process.env.REGISTRY, zeroAddress],
  ["sub1-res1", "ketsuban-demo-c", process.env.REGISTRY, process.env.PERMISSIONED_RESOLVER],
];
for (const [name, label, sub, res] of combos) {
  const secret = keccak256(concatHex([process.env.VIEWCODE_KEY, toHex(label), owner]));
  const data = encodeFunctionData({ abi, functionName: "register", args: [label, owner, secret, sub, res, 2419200n, process.env.PAYMENT_TOKEN, zeroHash] });
  const r = await fetch(process.env.RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ from: "0xF0121f93b1a1bAd73AdDC316B57684bD93D3254e", to: process.env.ETH_REGISTRAR, data }, "latest"] }) });
  const j = await r.json();
  let why = j.error ? j.error.data : "ok";
  if (why && why !== "0x" && why !== "ok") { try { why = decodeErrorResult({ abi: errors, data: why }).errorName; } catch {} }
  console.log(name, why);
}
