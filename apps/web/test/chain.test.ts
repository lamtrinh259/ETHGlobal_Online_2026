import { describe, expect, it, vi } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  namehash,
  parseAbiParameters,
  toFunctionSelector,
  type Hex,
} from "viem";
import { toBytes32 } from "@peeramid-labs/multipass-client";
import {
  bridgeWriteAbi,
  chainFor,
  commitEthName,
  errorsAbi,
  linkOwnName,
  registerEthName,
  registrarWriteAbi,
  resolverWriteAbi,
  tokenWriteAbi,
  writeProfileText,
  type Signer,
} from "@/lib/chain";

const ACCOUNT = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const RESOLVER = "0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7";
const BRIDGE = "0xC7283bD9Aad1B08947C841536946Ce4dA9c99929";
const REGISTRAR = "0xa88553f454b77203b0d036a05c894d555eaaa2cc";
const TOKEN = "0x768f42455a2d082e23ceef7d51e5787c82d67a39";
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

describe("getting a .eth name from the person's own wallet", () => {
  /** A registrar and token that answer reads, so the two steps can be driven without a chain. */
  function registrarProvider(state: { balance: bigint; committedAt: bigint; already?: boolean }) {
    const sent: { to: string; data: Hex }[] = [];
    let committed = !!state.already;
    const answer = (data: Hex): Hex => {
      const selector = data.slice(0, 10);
      const of = (sig: string) => toFunctionSelector(sig);
      if (selector === of("function getRegisterPrice(string,uint64,address) view returns (uint256,uint256)"))
        return encodeAbiParameters(parseAbiParameters("uint256, uint256"), [1000n, 0n]);
      if (selector === of("function balanceOf(address) view returns (uint256)"))
        return encodeAbiParameters(parseAbiParameters("uint256"), [state.balance]);
      if (
        selector ===
        of(
          "function makeCommitment(string,address,bytes32,address,address,uint64,bytes32) pure returns (bytes32)"
        )
      )
        return encodeAbiParameters(parseAbiParameters("bytes32"), [HASH]);
      if (selector === of("function commitmentAt(bytes32) view returns (uint64)"))
        return encodeAbiParameters(parseAbiParameters("uint64"), [committed ? state.committedAt : 0n]);
      throw new Error(`unexpected call ${selector}`);
    };
    const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      switch (method) {
        case "eth_chainId":
          return "0xaa36a7";
        case "eth_call":
          return answer((params![0] as { data: Hex }).data);
        case "eth_sendTransaction": {
          const tx = params![0] as { to: string; data: Hex };
          sent.push(tx);
          // A commit is what makes `commitmentAt` answer, which is how the second step finds it.
          if (tx.data.startsWith(toFunctionSelector("function commit(bytes32)"))) committed = true;
          return HASH;
        }
        case "eth_getTransactionReceipt":
          return {
            transactionHash: HASH,
            status: "0x1",
            blockNumber: "0x10",
            blockHash: HASH,
            logs: [],
            transactionIndex: "0x0",
            cumulativeGasUsed: "0x0",
            gasUsed: "0x0",
            effectiveGasPrice: "0x0",
            from: ACCOUNT,
            to: REGISTRAR,
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
    return { provider: { request } as never, sent };
  }

  const params = {
    registrar: REGISTRAR as `0x${string}`,
    token: TOKEN as `0x${string}`,
    resolver: RESOLVER as `0x${string}`,
    label: "alice-test",
    owner: ACCOUNT as `0x${string}`,
    duration: 2_419_200n,
  };

  it("mints what the name costs, approves it, and commits — in that order", async () => {
    // The registrar prices names in a token the person may not hold yet, and a test chain mints it.
    const p = registrarProvider({ balance: 0n, committedAt: 1_000n });
    const { readyAt } = await commitEthName(signer(p.provider), params);
    const calls = p.sent.map((s) => decodeFunctionData({ abi: [...tokenWriteAbi, ...registrarWriteAbi], data: s.data }));
    expect(calls.map((c) => c.functionName)).toEqual(["mint", "approve", "commit"]);
    expect(calls[0]?.args).toEqual([ACCOUNT, 1000n]);

    expect((calls[1]?.args?.[0] as string).toLowerCase()).toBe(REGISTRAR);
    expect(calls[1]?.args?.[1]).toBe(1000n);
    // The registrar makes the caller wait, and a second early is a revert.
    expect(readyAt).toBeGreaterThan(1_000);
  });

  it("skips the mint when the wallet can already pay", async () => {
    const p = registrarProvider({ balance: 5_000n, committedAt: 1_000n });
    await commitEthName(signer(p.provider), params);
    const names = p.sent.map(
      (s) => decodeFunctionData({ abi: [...tokenWriteAbi, ...registrarWriteAbi], data: s.data }).functionName
    );
    expect(names).toEqual(["approve", "commit"]);
  });

  it("does not commit twice for the same registration", async () => {
    // The registrar refuses to replace an unexpired commitment, so an attempt that comes back uses it.
    const p = registrarProvider({ balance: 5_000n, committedAt: 2_000n, already: true });
    await commitEthName(signer(p.provider), params);
    const names = p.sent.map(
      (s) => decodeFunctionData({ abi: [...tokenWriteAbi, ...registrarWriteAbi], data: s.data }).functionName
    );
    expect(names).not.toContain("commit");
  });

  it("registers the name to the wallet that signs, because the registrar mints only to its caller", async () => {
    const p = registrarProvider({ balance: 5_000n, committedAt: 1_000n });
    const hash = await registerEthName(signer(p.provider), params);
    expect(hash).toBe(HASH);
    const call = decodeFunctionData({ abi: registrarWriteAbi, data: p.sent[0].data });
    expect(call.functionName).toBe("register");
    expect(call.args?.[0]).toBe("alice-test");
    expect(call.args?.[1]).toBe(ACCOUNT);
    // A zero resolver and a zero subregistry make it revert with no reason at all.
    expect(call.args?.[4]).toBe(RESOLVER);
  });
});
