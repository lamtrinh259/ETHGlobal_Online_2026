import { describe, expect, it, vi } from "vitest";
import { zeroAddress, zeroHash, type Address } from "viem";
import { toBytes32 } from "@peeramid-labs/multipass-client";
import { Chain, eip712Warnings, ownershipWarnings } from "../../src/chain.js";
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
          const domain = Buffer.from((args?.[0] as string).slice(2), "hex")
            .toString()
            .replace(/\0+$/, "");
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

describe("provisioning a candidate's namespace", () => {
  it("creates it in the bridge's factory, even when a newer one exists", async () => {
    // The bridge grants the voucher the roles for their letter by asking its own factory. An instance it
    // cannot see gets no grant, and the letter reverts when the voucher tries to write it.
    const chain = new Chain({
      ...config,
      NAMESPACE_FACTORY: "0x9999999999999999999999999999999999999999",
      REGISTRY: "0x1111111111111111111111111111111111111111",
      PERMISSIONED_RESOLVER: "0x6666666666666666666666666666666666666666",
      REGISTRAR_ADDRESS: "0x7777777777777777777777777777777777777777",
    });
    const writes: { address: string; functionName: string }[] = [];
    Object.assign(chain, {
      indexer: { catchUp: async () => undefined },
      publicClient: {
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "isInstance") return false;
          if (functionName === "domains") return [];
          if (functionName === "getDomainState") return { name: zeroHash, isActive: false };
          if (functionName === "instance") return { registry: zeroAddress, parentName: "" };
          throw new Error(`unexpected ${functionName}`);
        }),
        waitForTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 1n })),
      },
      walletClient: {
        chain: { id: 31337 },
        account: { address: "0x5555555555555555555555555555555555555555" },
        writeContract: vi.fn(async (call: { address: string; functionName: string }) => {
          writes.push({ address: call.address, functionName: call.functionName });
          return "0xfeed";
        }),
      },
    });
    // No root instance to hang it under: it refuses rather than creating an orphan.
    await expect(chain.ensureVouchInstance("alice")).rejects.toThrow(/root registry/);
    expect(writes.filter((w) => w.functionName === "create")).toEqual([]);
  });

  /** A chain that knows no instances: enough to prove what is refused before anything is written. */
  function bare() {
    const chain = new Chain({
      ...config,
      REGISTRY: "0x1111111111111111111111111111111111111111",
      PERMISSIONED_RESOLVER: "0x6666666666666666666666666666666666666666",
      REGISTRAR_ADDRESS: "0x7777777777777777777777777777777777777777",
    });
    const writes: { functionName: string }[] = [];
    Object.assign(chain, {
      indexer: { catchUp: async () => undefined },
      publicClient: {
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "isInstance") return false;
          if (functionName === "domains") return [];
          if (functionName === "getDomainState") return { name: zeroHash, isActive: false };
          if (functionName === "instance") return { registry: zeroAddress, parentName: "" };
          throw new Error(`unexpected ${functionName}`);
        }),
        waitForTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 1n })),
      },
      walletClient: {
        chain: { id: 31337 },
        account: { address: "0x5555555555555555555555555555555555555555" },
        writeContract: vi.fn(async (call: { functionName: string }) => {
          writes.push({ functionName: call.functionName });
          return "0xfeed";
        }),
      },
    });
    return { chain, writes };
  }

  it("refuses an answer with no question to hang it under, rather than creating an orphan", async () => {
    // `dictator.kju-is.<root>` only means anything beneath the question it answers.
    const { chain, writes } = bare();
    await expect(chain.ensureAnswerInstance("kju-is", "dictator")).rejects.toThrow(/kju-is/);
    expect(writes.filter((w) => w.functionName === "create")).toEqual([]);
  });

  it("refuses an answer that cannot be a label, before anything is written", async () => {
    // "!!!" has no label, so there is no name it could ever have taken.
    const { chain, writes } = bare();
    await expect(chain.ensureAnswerInstance("kju-is", "!!!")).rejects.toThrow(/answer/i);
    expect(writes).toEqual([]);
  });
});

describe("which resolver an instance is read through", () => {
  it("follows what ENS resolves through, not the factory's copy of it", async () => {
    // Replacing a resolver changes the registry's pointer; the factory keeps the address it recorded
    // when the instance was made. Reading the factory's copy sends every text lookup to a contract
    // ENS no longer resolves through, so a record written on the live one is invisible.
    const chain = new Chain({ ...config, ETH_REGISTRY: "0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2" });
    const stale = "0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e";
    const live = "0xa2602ce1A469d7FF1090aE4b876BA4ec566D3873";
    Object.assign(chain, {
      indexer: { catchUp: async () => undefined },
      publicClient: {
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "domains") return [toBytes32("kju-is")];
          if (functionName === "instance")
            return {
              registry: "0x254D9c7601BD8fa6b6FA7f5A42c860d184E053A7",
              resolver: stale,
              parent: zeroAddress,
              parentLabel: "kju-is",
              parentName: "kju-is.eth",
            };
          if (functionName === "mirror") return { registry: zeroAddress };
          if (functionName === "getResolver") return live;
          throw new Error(`unexpected ${functionName}`);
        }),
      },
    });
    const [instance] = await chain.instances();
    expect(instance.resolver).toBe(live);
  });

  it("keeps the factory's resolver where the registry names none", async () => {
    // Not every instance is registered in the eth registry; a zero answer is not a correction.
    const chain = new Chain({ ...config, ETH_REGISTRY: "0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2" });
    const known = "0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e";
    Object.assign(chain, {
      indexer: { catchUp: async () => undefined },
      publicClient: {
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "domains") return [toBytes32("kju-is")];
          if (functionName === "instance")
            return {
              registry: "0x254D9c7601BD8fa6b6FA7f5A42c860d184E053A7",
              resolver: known,
              parent: zeroAddress,
              parentLabel: "kju-is",
              parentName: "kju-is.eth",
            };
          if (functionName === "mirror") return { registry: zeroAddress };
          if (functionName === "getResolver") return zeroAddress;
          throw new Error(`unexpected ${functionName}`);
        }),
      },
    });
    expect((await chain.instances())[0].resolver).toBe(known);
  });
});

describe("relaying a signed record", () => {
  /** Multipass answers whether the id already has a record, and what the domain charges. */
  function relaying(chain: Chain, exists: boolean, fees = { fee: 7n, renewalFee: 3n }) {
    const writes: { address: string; functionName: string; value?: bigint }[] = [];
    Object.assign(chain, {
      indexer: { catchUp: async () => undefined },
      publicClient: {
        readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
          if (functionName === "resolveRecord") return [exists, {}];
          if (functionName === "getDomainState") return fees;
          throw new Error(`unexpected read ${functionName}`);
        }),
        waitForTransactionReceipt: vi.fn(async () => ({ status: "success", blockNumber: 1n })),
      },
      walletClient: {
        chain: { id: 31337 },
        account: { address: "0x5555555555555555555555555555555555555555" },
        writeContract: vi.fn(async (call: { address: string; functionName: string; value?: bigint }) => {
          writes.push({ address: call.address, functionName: call.functionName, value: call.value });
          return "0xfeed";
        }),
      },
    });
    return writes;
  }

  const record = {
    name: "0x01" as const,
    id: "0x02" as const,
    domainName: "0x03" as const,
    validUntil: 1n,
    nonce: 1n,
    wallet: "0x6666666666666666666666666666666666666666" as const,
    payload: zeroHash,
  };

  it("registers a first record through the bridge, paying the domain fee", async () => {
    // The bridge is what grants profile keys, so a first record has to go through it.
    const chain = new Chain(config);
    const writes = relaying(chain, false);
    await chain.submit(record, "0x99");
    expect(writes).toEqual([{ address: config.BRIDGE, functionName: "verify", value: 7n }]);
  });

  it("renews an existing one on Multipass instead, because register reverts on a second write", async () => {
    // This is the bug that reached users as `recordExists`: the same call cannot do both.
    const chain = new Chain(config);
    const writes = relaying(chain, true);
    await chain.submit(record, "0x99");
    expect(writes).toEqual([{ address: config.MULTIPASS, functionName: "renewRecord", value: 3n }]);
  });
});

/**
 * Whether a signature this service makes will be accepted at all.
 *
 * A record is signed over an EIP-712 domain built from configuration, and Multipass checks it against
 * the one it was deployed with. Disagree on a character of the name or the version and every
 * attestation reverts at `register` — after the person has already signed, which reads as a broken
 * product rather than as a wrong setting.
 */
describe("who can delete a record, read off the chain", () => {
  /*
   * The Multipass owner can `deleteName` any record in any domain. The product's whole claim is that a
   * reference cannot be deleted, so the one key that can is worth naming — and naming loudest when it
   * is the relayer, a hot key that signs transactions all day and is the likeliest to be taken.
   */
  const relayer = "0x2222222222222222222222222222222222222222" as const;
  const cold = "0x1111111111111111111111111111111111111111" as const;

  it("says nothing when the owner is a key that does nothing else", () => {
    expect(ownershipWarnings(relayer, cold)).toEqual([]);
  });

  it("names the relayer holding it, because one stolen key would then delete records", () => {
    const [said] = ownershipWarnings(relayer, relayer);
    expect(said).toMatch(/delete any record/i);
    expect(said).toMatch(/relayer/i);
  });

  it("reads the same whichever case the chain answers in", () => {
    expect(
      ownershipWarnings(relayer, relayer.toUpperCase().replace("0X", "0x") as typeof relayer)
    ).toHaveLength(1);
  });
});

describe("the signing domain read off the chain", () => {
  const healthy: Parameters<typeof eip712Warnings>[1] = [
    "0x0f",
    "MultipassDNS",
    "1.0.0",
    31337n,
    config.MULTIPASS,
    zeroHash,
    [],
  ];

  it("says nothing when the contract signs the way this service does", () => {
    expect(eip712Warnings(config, healthy)).toEqual([]);
  });

  it("names the mismatch when the version drifted, and what it costs", () => {
    const drifted = [...healthy] as typeof healthy;
    drifted[2] = "2.0.0";
    const [said] = eip712Warnings(config, drifted);
    expect(said).toMatch(/"1.0.0" but the contract signs as .*"2.0.0"/);
    expect(said).toMatch(/would be rejected/);
  });

  it("names it when the contract signs for another chain", () => {
    const elsewhere = [...healthy] as typeof healthy;
    elsewhere[3] = 1n;
    expect(eip712Warnings(config, elsewhere)[0]).toMatch(/signs for chain 1 /);
  });

  it("names it when the contract signs for another address", () => {
    // The verifying contract is part of the digest, so a Multipass moved to a new address rejects
    // every signature made for the old one, whatever the name and version say.
    const moved = [...healthy] as typeof healthy;
    moved[4] = "0x000000000000000000000000000000000000dEaD";
    expect(eip712Warnings(config, moved)[0]).toMatch(/at 0x000000000000000000000000000000000000dEaD/);
  });
});
