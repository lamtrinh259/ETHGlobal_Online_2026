import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, getAbiItem, toEventSelector, type Hex } from "viem";
import { MultipassAbi, toBytes32 } from "@peeramid-labs/multipass-client";
import { decodeLogs, RpcSource } from "../../src/logs.js";

const MULTIPASS = "0x418F82fd0014a4CA402F145978bfaF0555a9cA06";
const registered = getAbiItem({ abi: MultipassAbi, name: "Registered" });
const renewed = getAbiItem({ abi: MultipassAbi, name: "Renewed" });
const WALLET = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";

/** A real `Registered` log: domainName indexed, the record struct in data. */
function registeredLog(domain: string, name: string, block: number) {
  const record = {
    wallet: WALLET,
    name: toBytes32(name),
    id: toBytes32(`${name}-id`),
    nonce: 1n,
    domainName: toBytes32(domain),
    validUntil: 1_800_000_000n,
    payload: toBytes32("hi"),
  } as const;
  const tuple = registered.inputs[1];
  return {
    block_number: block,
    log_index: 0,
    topic0: toEventSelector(registered),
    topic1: toBytes32(domain),
    data: encodeAbiParameters([tuple], [record]),
  };
}

describe("decodeLogs", () => {
  it("decodes the record struct and drops logs of another shape", () => {
    const log = registeredLog("kju-is", "alice", 120);
    const decoded = decodeLogs<{ domainName: Hex; NewRecord: { name: Hex; wallet: Hex } }>(registered, [
      { blockNumber: 120n, logIndex: 0, topics: [log.topic0 as Hex, log.topic1 as Hex], data: log.data },
      { blockNumber: 121n, logIndex: 1, topics: [toEventSelector(renewed)], data: "0x" },
    ]);
    expect(decoded).toHaveLength(1);
    expect(decoded[0].NewRecord.name).toBe(toBytes32("alice"));
    expect(decoded[0].blockNumber).toBe(120n);
  });
});

describe("RpcSource", () => {
  it("reports the chain head", async () => {
    const client = { getBlockNumber: vi.fn(async () => 42n), getLogs: vi.fn() };
    expect(await new RpcSource(client as never).head()).toBe(42n);
  });

  it("walks the range in windows, halves on failure, and filters indexed topics itself", async () => {
    const ranges: [bigint, bigint][] = [];
    const client = {
      getBlockNumber: vi.fn(async () => 25_000n),
      getLogs: vi.fn(async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        if (toBlock - fromBlock + 1n > 5_000n) throw new Error("query returned more than 10000 results");
        ranges.push([fromBlock, toBlock]);
        return fromBlock === 0n
          ? [
              {
                blockNumber: 10n,
                logIndex: 0,
                topics: [toEventSelector(renewed), WALLET as Hex],
                data: "0x",
              },
              {
                blockNumber: 11n,
                logIndex: 1,
                topics: [toEventSelector(renewed), ("0x" + "9".repeat(40)) as Hex],
                data: "0x",
              },
            ]
          : [];
      }),
    };
    const src = new RpcSource(client as never, 10_000n, 1_000n);
    const logs = await src.logs({
      address: MULTIPASS,
      event: renewed,
      topics: [WALLET as Hex],
      fromBlock: 0n,
    });
    expect(logs.map((l) => Number(l.blockNumber))).toEqual([10]);
    expect(ranges[0]).toEqual([0n, 4_999n]);
    expect(ranges.at(-1)?.[1]).toBe(25_000n);
    expect(ranges.every(([f, t]) => t - f + 1n <= 5_000n)).toBe(true);
  });

  it("gives up when even the smallest window fails", async () => {
    const client = {
      getBlockNumber: vi.fn(async () => 100n),
      getLogs: vi.fn(async () => {
        throw new Error("provider down");
      }),
    };
    await expect(
      new RpcSource(client as never, 1_000n, 1_000n).logs({
        address: MULTIPASS,
        event: renewed,
        fromBlock: 0n,
      })
    ).rejects.toThrow("provider down");
  });
});
