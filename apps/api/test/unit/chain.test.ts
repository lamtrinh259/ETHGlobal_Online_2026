import { describe, expect, it, vi } from "vitest";
import { zeroAddress, type Address } from "viem";
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
