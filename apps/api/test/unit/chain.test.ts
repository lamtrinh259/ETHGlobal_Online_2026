import { describe, expect, it, vi } from "vitest";
import { zeroAddress, zeroHash, type Address } from "viem";
import { Chain } from "../../src/chain.js";
import { loadConfig } from "../../src/config.js";

const config = loadConfig({
  RPC_URL: "http://127.0.0.1:8545",
  CHAIN_ID: "31337",
  MULTIPASS: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  BRIDGE: "0x0B306BF915C4d645ff596e518fAf3F9669b97016",
  FACTORY: "0x9A676e781A523b5d0C0e43731313A708CB607508",
  RELAYER_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  PRIVY_APP_ID: "app",
  PRIVY_VERIFICATION_KEY_JWK: JSON.stringify({ kty: "EC", crv: "P-256", x: "a", y: "b" }),
  NAME_DOMAINS: "kju-is",
});

/** One domain, answered as the factory would: the mount, then no mirror. */
function stubbed(chain: Chain) {
  const calls: string[] = [];
  const instance = {
    registry: "0x1111111111111111111111111111111111111111" as Address,
    resolver: "0x2222222222222222222222222222222222222222" as Address,
    parent: zeroAddress,
    parentLabel: "kju-is",
    parentName: "kju-is.eth",
  };
  Object.assign(chain, {
    publicClient: {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        calls.push(functionName);
        if (functionName === "domains") return [`0x${Buffer.from("kju-is").toString("hex").padEnd(64, "0")}`];
        if (functionName === "instance") return instance;
        throw new Error("no mirror");
      }),
    },
  });
  return calls;
}

/** A deployment where nothing is mounted yet: every read answers empty, every write succeeds. */
function provisioning(chain: Chain) {
  const writes: { functionName: string; args: unknown[] }[] = [];
  const deployed: string[] = [];
  const root = {
    registry: "0x1111111111111111111111111111111111111111" as Address,
    resolver: "0x2222222222222222222222222222222222222222" as Address,
    parent: zeroAddress,
    parentLabel: "kju-is",
    parentName: "kju-is.eth",
  };
  const empty = { ...root, registry: zeroAddress, resolver: zeroAddress, parentName: "" };
  const made = { ...root, registry: "0x3333333333333333333333333333333333333333" as Address };
  let created = false;
  Object.assign(chain, {
    indexer: { catchUp: async () => undefined },
    publicClient: {
      readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
        if (functionName === "domains") return [`0x${Buffer.from("kju-is").toString("hex").padEnd(64, "0")}`];
        if (functionName === "instance" || functionName === "mirror") {
          const domain = Buffer.from((args?.[0] as string).slice(2), "hex").toString().replace(/\0+$/, "");
          if (domain === "kju-is") return root;
          return created ? made : empty;
        }
        if (functionName === "getSubregistry") return zeroAddress;
        if (functionName === "getDomainState") return { name: zeroHash, isActive: false };
        throw new Error(`unexpected read ${functionName}`);
      }),
      waitForTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: 1n,
        contractAddress: "0x4444444444444444444444444444444444444444",
      })),
    },
    walletClient: {
      chain: { id: 31337 },
      account: { address: "0x5555555555555555555555555555555555555555" },
      writeContract: vi.fn(async (call: { functionName: string; args: unknown[] }) => {
        writes.push({ functionName: call.functionName, args: call.args });
        if (call.functionName === "create" || call.functionName === "createMirror") created = true;
        return "0xdead";
      }),
      deployContract: vi.fn(async ({ args }: { args: unknown[] }) => {
        deployed.push(args[1] as string);
        return "0xbeef";
      }),
    },
  });
  return { writes, deployed };
}

describe("mounting a domain nobody deployed", () => {
  const configured = {
    ...config,
    NAMESPACE_FACTORY: config.FACTORY,
    REGISTRY: "0x1111111111111111111111111111111111111111" as Address,
    PERMISSIONED_RESOLVER: "0x6666666666666666666666666666666666666666" as Address,
    REGISTRAR_ADDRESS: "0x7777777777777777777777777777777777777777" as Address,
  };

  it("builds the levels, the instance and the mirror, first label first", async () => {
    const chain = new Chain(configured);
    const { writes, deployed } = provisioning(chain);
    const out = await chain.ensureNamespace("x.com");

    expect(out).toMatchObject({ created: true, parentName: "com.x.www.kju-is.eth" });
    // A platform lands under `www`, its mirror under `private-www`, each level deployed once.
    expect(deployed).toEqual(["www", "x", "private-www", "x"]);
    // The Multipass domain has to exist before a record can be written into it.
    expect(writes.map((w) => w.functionName)).toEqual([
      "initializeDomain",
      "activateDomain",
      "setSubregistry",
      "setSubregistry",
      "create",
      "setSubregistry",
      "setSubregistry",
      "setSubregistry",
      "createMirror",
      "setSubregistry",
    ]);
    const mirror = writes.find((w) => w.functionName === "createMirror");
    expect(mirror?.args[4]).toBe("com.x.private-www.kju-is.eth");
  });

  it("puts a mail host under the at-sign level instead", async () => {
    const chain = new Chain(configured);
    const { deployed } = provisioning(chain);
    const out = await chain.ensureNamespace("peeramid.xyz");
    expect(out.parentName).toBe("xyz.peeramid.@.kju-is.eth");
    expect(deployed).toEqual(["@", "peeramid", "private@", "peeramid"]);
  });

  it("refuses what it cannot mount, and says which part is missing", async () => {
    const chain = new Chain(configured);
    provisioning(chain);
    await expect(chain.ensureNamespace("myspace")).rejects.toThrow(/not a DNS name/);

    const bare = new Chain(config);
    provisioning(bare);
    await expect(bare.ensureNamespace("x.com")).rejects.toThrow(/NAMESPACE_FACTORY/);
  });
});

describe("reading the mounts", () => {
  it("reuses the list rather than asking twice for every page", async () => {
    // Two calls per domain, and every page asks: without this a profile view is dozens of RPC calls.
    const chain = new Chain(config);
    const calls = stubbed(chain);
    const first = await chain.instances();
    const again = await chain.instances();
    expect(first).toEqual(again);
    expect(calls.filter((c) => c === "domains")).toHaveLength(1);
  });

  it("asks again once the reuse window has passed", async () => {
    const chain = new Chain({ ...config, MOUNT_CACHE_SECONDS: 0 });
    const calls = stubbed(chain);
    await chain.instances();
    await chain.instances();
    expect(calls.filter((c) => c === "domains")).toHaveLength(2);
  });
});
