import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, namehash, type Hex } from "viem";
import { toBytes32 } from "@peeramid-labs/multipass-client";
import {
  bridgeWriteAbi,
  chainFor,
  errorsAbi,
  linkOwnName,
  resolverWriteAbi,
  writeProfileText,
  type Signer,
} from "@/lib/chain";

const ACCOUNT = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const RESOLVER = "0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7";
const BRIDGE = "0xC7283bD9Aad1B08947C841536946Ce4dA9c99929";
const HASH = `0x${"ab".repeat(32)}` as Hex;

/** Minimal EIP-1193 wallet: records eth_sendTransaction, answers chain id and receipts. */
function fakeProvider(status: "0x1" | "0x0" = "0x1", chains: string[] = ["0xaa36a7"]) {
  const sent: { to: string; from: string; data: Hex }[] = [];
  const switched: unknown[] = [];
  let chainId = chains[0] as string;
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    switch (method) {
      case "eth_chainId":
        return chainId;
      case "wallet_switchEthereumChain": {
        switched.push(params![0]);
        if (chains.length < 2) throw new Error("wallet refused");
        chainId = chains[1] as string;
        return null;
      }
      case "eth_sendTransaction": {
        sent.push(params![0] as { to: string; from: string; data: Hex });
        return HASH;
      }
      case "eth_getTransactionReceipt":
        return {
          transactionHash: HASH,
          status,
          blockNumber: "0x10",
          blockHash: HASH,
          logs: [],
          transactionIndex: "0x0",
          cumulativeGasUsed: "0x0",
          gasUsed: "0x0",
          effectiveGasPrice: "0x0",
          from: ACCOUNT,
          to: RESOLVER,
          contractAddress: null,
          logsBloom: "0x",
          type: "0x2",
        };
      case "eth_blockNumber":
        return "0x10";
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
  return { provider: { request } as never, sent, request, switched };
}

const signer = (provider: never): Signer => ({ provider, account: ACCOUNT, chainId: 11155111 });

describe("error decoding", () => {
  it("carries every deployment error, so a revert is never a bare selector", () => {
    const names = errorsAbi.map((e) => ("name" in e ? e.name : ""));
    // The three that actually reached users: a missing domain, a wrong registrar key, a double write.
    expect(names).toContain("invalidDomain");
    expect(names).toContain("invalidSignature");
    expect(names).toContain("recordExists");
    expect(errorsAbi.every((e) => e.type === "error")).toBe(true);
    // Both write paths can decode them.
    expect(resolverWriteAbi.filter((e) => e.type === "error").length).toBe(errorsAbi.length);
    expect(bridgeWriteAbi.filter((e) => e.type === "error").length).toBe(errorsAbi.length);
  });
});

describe("chainFor", () => {
  it("knows sepolia and anvil and defines anything else", () => {
    expect(chainFor(11155111).name).toBe("Sepolia");
    expect(chainFor(31337).id).toBe(31337);
    expect(chainFor(424242)).toMatchObject({ id: 424242, name: "chain-424242" });
  });
});

describe("writeProfileText", () => {
  it("sends setText(namehash(name), key, value) from the account to the resolver and waits for success", async () => {
    const p = fakeProvider();
    const hash = await writeProfileText(
      signer(p.provider),
      RESOLVER,
      "alice.ketsuban.eth",
      "url",
      "https://a.example"
    );
    expect(hash).toBe(HASH);
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0].from.toLowerCase()).toBe(ACCOUNT.toLowerCase());
    expect(p.sent[0].to.toLowerCase()).toBe(RESOLVER.toLowerCase());
    expect(decodeFunctionData({ abi: resolverWriteAbi, data: p.sent[0].data })).toEqual({
      functionName: "setText",
      args: [namehash("alice.ketsuban.eth"), "url", "https://a.example"],
    });
  });

  it("throws when the receipt says reverted", async () => {
    const p = fakeProvider("0x0");
    await expect(
      writeProfileText(signer(p.provider), RESOLVER, "alice.ketsuban.eth", "email", "x")
    ).rejects.toThrow(/reverted/);
  });
});

describe("the wallet's own network", () => {
  it("is switched to this deployment's chain before anything is signed", async () => {
    // A wallet left on mainnet signs nothing useful here, and viem's refusal is two chain ids and a
    // calldata blob. One switch request fixes it.
    const p = fakeProvider("0x1", ["0x1", "0xaa36a7"]);
    await writeProfileText(signer(p.provider), RESOLVER, "alice.ketsuban.eth", "url", "https://a.example");
    expect(p.switched).toEqual([{ chainId: "0xaa36a7" }]);
    expect(p.sent).toHaveLength(1);
  });

  it("says which network to switch to when the wallet will not", async () => {
    const p = fakeProvider("0x1", ["0x1"]);
    await expect(
      writeProfileText(signer(p.provider), RESOLVER, "alice.ketsuban.eth", "url", "https://a.example")
    ).rejects.toThrow(/on chain 1.*Sepolia \(11155111\)/);
    expect(p.sent).toHaveLength(0);
  });
});

describe("linkOwnName", () => {
  it("encodes the domain as bytes32 and the label as-is", async () => {
    const p = fakeProvider();
    await linkOwnName(signer(p.provider), BRIDGE, "ketsuban", "alice");
    expect(p.sent[0].to.toLowerCase()).toBe(BRIDGE.toLowerCase());
    expect(decodeFunctionData({ abi: bridgeWriteAbi, data: p.sent[0].data })).toEqual({
      functionName: "linkOwnName",
      args: [toBytes32("ketsuban"), "alice"],
    });
  });
});
