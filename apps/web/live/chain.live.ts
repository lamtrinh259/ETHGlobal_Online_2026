import { createPublicClient, http, decodeAbiParameters, encodeFunctionData, namehash, type Hex } from "viem";
import { describe, expect, it } from "vitest";

/**
 * Does the chain say what the attester says?
 *
 * Every page here promises a verifier they need not trust this service: the names are ENS names and
 * the records are on chain, so the claim can be checked without us. Nothing checked it. A service
 * answering from a stale index, a wrong instance, or its own memory would look exactly like a working
 * one — every schema would still parse and every page would still render.
 *
 * So this asks the attester what it believes, then asks the chain the same question through the
 * Universal Resolver, and compares. No part of the API is in the second path.
 *
 *   pnpm --filter @ketsuban/web check:live
 */
const API = (process.env.CHECK_API ?? "https://ketsuban-api.peeramid.xyz").replace(/\/$/, "");
const HANDLE = process.env.CHECK_HANDLE ?? "peersky";
const ROOT = process.env.CHECK_ROOT ?? "ketsuban.eth";
const SUBJECT = process.env.CHECK_SUBJECT ?? "kju-is";
const RPC = process.env.CHECK_RPC ?? "https://ethereum-sepolia-rpc.publicnode.com";

/** DNS wire format: each label length-prefixed, terminated by a zero byte. */
const wire = (name: string): Hex =>
  `0x${name
    .split(".")
    .map((l) => Buffer.from([l.length, ...Buffer.from(l)]).toString("hex"))
    .join("")}00`;

const RESOLVE = [
  {
    type: "function",
    name: "resolve",
    stateMutability: "view",
    inputs: [
      { name: "name", type: "bytes" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "result", type: "bytes" },
      { name: "resolver", type: "address" },
    ],
  },
] as const;

const api = async (path: string) => {
  const res = await fetch(`${API}${path}`);
  expect(res.ok, `${path} answered ${res.status}`).toBe(true);
  return res.json();
};

/** What the chain answers for one name, with nothing of this deployment's in the path but the address. */
async function onChain(universalResolver: Hex, name: string, call: Hex) {
  const client = createPublicClient({ transport: http(RPC) });
  const [result] = await client.readContract({
    address: universalResolver,
    abi: RESOLVE,
    functionName: "resolve",
    args: [wire(name), call],
  });
  return result as Hex;
}

describe(`whether the chain agrees with ${API}`, () => {
  it("resolves every name the attester claims to the wallet it claims", async () => {
    const { config } = await api("/healthz");
    const ur = config.universalResolver as Hex;
    expect(ur, "this deployment has no Universal Resolver configured").toBeTruthy();

    const v = await api(`/v1/verify/${HANDLE}.${ROOT}`);
    expect(v.status, `${HANDLE}.${ROOT} is not active, so there is nothing to compare`).toBe("active");

    // The name itself, and every account it says that wallet attested in the open or behind a mask.
    const names: string[] = [
      v.name,
      ...(v.links ?? []).map((l: { ensName: string | null }) => l.ensName).filter(Boolean),
    ];
    expect(names.length, "no names to check").toBeGreaterThan(1);

    for (const name of names) {
      const data = encodeFunctionData({
        abi: [
          { type: "function", name: "addr", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "address" }] },
        ] as const,
        functionName: "addr",
        args: [namehash(name)],
      });
      const [addr] = decodeAbiParameters([{ type: "address" }], await onChain(ur, name, data));
      expect(addr.toLowerCase(), `${name} resolves elsewhere on chain`).toBe(v.wallet.toLowerCase());
    }
  }, 120_000);

  it("reports the answer the chain holds, not one it remembers", async () => {
    const { config } = await api("/healthz");
    const name = `${HANDLE}.${SUBJECT}.${ROOT}`;
    const key = "ketsuban:answer";
    const mine = await api(`/v1/ens/${name}`);
    const data = encodeFunctionData({
      abi: [
        { type: "function", name: "text", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "string" }], outputs: [{ type: "string" }] },
      ] as const,
      functionName: "text",
      args: [namehash(name), key],
    });
    const [theirs] = decodeAbiParameters(
      [{ type: "string" }],
      await onChain(config.universalResolver as Hex, name, data)
    );
    expect(theirs, `${name} answers differently on chain`).toBe(mine.texts?.[key] ?? "");
  }, 120_000);
});
