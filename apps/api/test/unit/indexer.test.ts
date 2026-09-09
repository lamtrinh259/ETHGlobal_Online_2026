import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, getAbiItem, toEventSelector, zeroHash, type Hex } from "viem";
import { MultipassAbi, toBytes32 } from "@peeramid-labs/multipass-client";
import { Indexer, startIndexer } from "../../src/indexer.js";
import type { LogQuery, LogSource, RawLog } from "../../src/logs.js";

const MULTIPASS = "0x418F82fd0014a4CA402F145978bfaF0555a9cA06";
const ALICE = "0xEE4811b9462956C9C3535E79c08776D769CA9F3a";
const BOB = "0xd70b1f4b1cd2cb2dd6e4f0f5b0f7c1f2a3b494a0";
const REGISTERED = getAbiItem({ abi: MultipassAbi, name: "Registered" });
const RENEWED = getAbiItem({ abi: MultipassAbi, name: "Renewed" });
const DELETED = getAbiItem({ abi: MultipassAbi, name: "nameDeleted" });
const FUTURE = 4_000_000_000n;

type Rec = {
  domain: string;
  name: string;
  wallet: string;
  nonce: bigint;
  validUntil?: bigint;
  payload?: string;
};

function record(r: Rec) {
  return {
    wallet: r.wallet as Hex,
    name: toBytes32(r.name),
    id: toBytes32(`${r.name}@${r.domain}`),
    nonce: r.nonce,
    domainName: toBytes32(r.domain),
    validUntil: r.validUntil ?? FUTURE,
    payload: r.payload ? toBytes32(r.payload) : zeroHash,
  } as const;
}

const registeredLog = (r: Rec, block: bigint): RawLog => ({
  blockNumber: block,
  logIndex: 0,
  topics: [toEventSelector(REGISTERED), toBytes32(r.domain)],
  data: encodeAbiParameters([REGISTERED.inputs[1]], [record(r)]),
});

const renewedLog = (r: Rec, block: bigint): RawLog => ({
  blockNumber: block,
  logIndex: 0,
  topics: [
    toEventSelector(RENEWED),
    `0x${"0".repeat(24)}${r.wallet.slice(2)}` as Hex,
    toBytes32(r.domain),
    toBytes32(`${r.name}@${r.domain}`),
  ],
  data: encodeAbiParameters([RENEWED.inputs[3]], [record(r)]),
});

const deletedLog = (r: Rec, block: bigint): RawLog => ({
  blockNumber: block,
  logIndex: 0,
  topics: [
    toEventSelector(DELETED),
    toBytes32(r.domain),
    `0x${"0".repeat(24)}${r.wallet.slice(2)}` as Hex,
    toBytes32(`${r.name}@${r.domain}`),
  ],
  data: encodeAbiParameters([{ type: "bytes32" }], [toBytes32(r.name)]),
});

/** A log source that answers from a fixed script, respecting the window a tick asks for. */
function fakeSource(head: bigint, logs: RawLog[]) {
  const calls: LogQuery[] = [];
  const source: LogSource = {
    head: vi.fn(async () => head),
    logs: vi.fn(async (q: LogQuery) => {
      calls.push(q);
      const topic0 = q.topics ? undefined : undefined;
      void topic0;
      return logs.filter(
        (l) =>
          l.topics[0] === toEventSelector(q.event) &&
          l.blockNumber >= q.fromBlock &&
          (q.toBlock === undefined || l.blockNumber <= q.toBlock)
      );
    }),
  };
  return { source, calls };
}

describe("Indexer", () => {
  it("keeps the latest state per record, honours renewals and deletions, and answers both queries", async () => {
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n, payload: "hi" };
    const bob: Rec = { domain: "~alice", name: "bob", wallet: BOB, nonce: 1n, payload: "worked together" };
    const gone: Rec = { domain: "x", name: "alice_x", wallet: ALICE, nonce: 1n };
    const { source, calls } = fakeSource(500n, [
      registeredLog(alice, 100n),
      registeredLog(bob, 110n),
      registeredLog(gone, 120n),
      renewedLog({ ...alice, nonce: 2n, payload: "terrible dictator", validUntil: FUTURE + 1n }, 300n),
      deletedLog(gone, 400n),
    ]);
    const indexer = new Indexer(source, MULTIPASS, 50n);
    expect(await indexer.tick()).toBe(5);
    expect(calls.every((c) => c.fromBlock === 50n && c.toBlock === 500n)).toBe(true);

    const kju = indexer.recordsByDomain("kju-is");
    expect(kju).toHaveLength(1);
    expect(kju[0]).toMatchObject({ name: "alice", nonce: 2n, validUntil: FUTURE + 1n, block: 300n });
    expect(indexer.recordsByDomain("x")).toEqual([]);
    expect(indexer.recordsByWallet(ALICE).map((r) => r.domain)).toEqual(["kju-is"]);
    expect(
      indexer.recordsByWallet(BOB.toUpperCase().replace("0X", "0x") as `0x${string}`).map((r) => r.name)
    ).toEqual(["bob"]);
    expect(indexer.status()).toEqual({ indexedBlock: 500, head: 500, records: 2, synced: true });

    expect(await indexer.tick()).toBe(0);
  });

  it("never moves a record backwards when a window is replayed", async () => {
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n };
    const { source } = fakeSource(200n, [
      registeredLog(alice, 100n),
      renewedLog({ ...alice, nonce: 5n, validUntil: FUTURE + 9n }, 150n),
    ]);
    const indexer = new Indexer(source, MULTIPASS, 1n);
    await indexer.tick();
    expect(indexer.recordsByDomain("kju-is")[0].nonce).toBe(5n);

    const replay = new Indexer(source, MULTIPASS, 1n);
    await replay.tick();
    await replay.tick();
    expect(replay.recordsByDomain("kju-is")[0].nonce).toBe(5n);
  });

  it("serialises overlapping ticks so a catch-up never skips a block a poll claimed", async () => {
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n };
    const bob: Rec = { domain: "~alice", name: "bob", wallet: BOB, nonce: 1n, payload: "worked together" };
    let head = 100n;
    const logs = [registeredLog(alice, 90n)];
    const source: LogSource = {
      head: vi.fn(async () => head),
      logs: vi.fn(async (q: LogQuery) => {
        // a slow provider: the second tick's head moves while the first is still reading
        await new Promise((r) => setTimeout(r, 5));
        return logs.filter(
          (l) =>
            l.topics[0] === toEventSelector(q.event) &&
            l.blockNumber >= q.fromBlock &&
            (q.toBlock === undefined || l.blockNumber <= q.toBlock)
        );
      }),
    };
    const indexer = new Indexer(source, MULTIPASS, 1n);
    const first = indexer.tick();
    head = 200n;
    logs.push(registeredLog(bob, 150n));
    const second = indexer.tick();
    await Promise.all([first, second]);
    expect(indexer.status()).toMatchObject({ indexedBlock: 200, records: 2, synced: true });
    expect(indexer.recordsByDomain("~alice").map((r) => r.name)).toEqual(["bob"]);
  });

  it("catchUp rescans a block the cursor already passed", async () => {
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n };
    const bob: Rec = { domain: "~alice", name: "bob", wallet: BOB, nonce: 1n };
    const logs = [registeredLog(alice, 90n)];
    const src = fakeSource(100n, logs);
    const indexer = new Indexer(src.source, MULTIPASS, 1n);
    await indexer.tick();
    expect(indexer.status()).toMatchObject({ indexedBlock: 100, records: 1 });

    // A log inside a window the cursor already claimed: only an explicit catch-up can find it.
    logs.push(registeredLog(bob, 95n));
    expect(await indexer.tick()).toBe(0);
    expect(await indexer.catchUp(95n)).toBe(1);
    expect(indexer.recordsByDomain("~alice").map((r) => r.name)).toEqual(["bob"]);
    expect(indexer.status().indexedBlock).toBe(100);
  });

  it("persists a snapshot and resumes from it instead of rescanning", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ketsuban-index-"));
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n, payload: "hi" };
    const first = fakeSource(400n, [registeredLog(alice, 100n)]);
    const a = new Indexer(first.source, MULTIPASS, 50n, { dataDir });
    await a.tick();
    expect(JSON.parse(readFileSync(join(dataDir, "records.json"), "utf8")).indexedBlock).toBe("400");

    const second = fakeSource(600n, [registeredLog({ ...alice, name: "carol" }, 500n)]);
    const b = new Indexer(second.source, MULTIPASS, 50n, { dataDir });
    expect(b.recordsByDomain("kju-is").map((r) => r.name)).toEqual(["alice"]);
    await b.tick();
    expect(second.calls[0].fromBlock).toBe(401n);
    expect(
      b
        .recordsByDomain("kju-is")
        .map((r) => r.name)
        .sort()
    ).toEqual(["alice", "carol"]);

    const fresh = new Indexer(fakeSource(600n, []).source, MULTIPASS, 5_000n, { dataDir });
    expect(fresh.status().indexedBlock).toBe(4_999);
    expect(fresh.recordsByDomain("kju-is")).toEqual([]);
  });

  it("survives an unreadable snapshot directory and a failing tick", async () => {
    const indexer = new Indexer(fakeSource(10n, []).source, MULTIPASS, 1n, { dataDir: "/proc/nope" });
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m) => void errors.push(String(m)));
    await indexer.tick();
    expect(errors.some((e) => e.startsWith("index snapshot failed"))).toBe(true);

    const broken: LogSource = {
      head: vi.fn(async () => {
        throw new Error("dRPC 429");
      }),
      logs: vi.fn(async () => []),
    };
    const loop = startIndexer(new Indexer(broken, MULTIPASS, 1n), 0.01);
    await vi.waitFor(() => expect(errors.some((e) => e.includes("index tick failed · dRPC 429"))).toBe(true));
    loop.stop();
    spy.mockRestore();
  });
});
