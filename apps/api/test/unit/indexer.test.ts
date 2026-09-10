import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const logsIn = (q: LogQuery, logs: RawLog[]) =>
  logs.filter(
    (l) =>
      l.topics[0] === toEventSelector(q.event) &&
      l.blockNumber >= q.fromBlock &&
      (q.toBlock === undefined || l.blockNumber <= q.toBlock)
  );

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
    expect(indexer.status()).toMatchObject({ indexedBlock: 500, head: 500, records: 2, synced: true });
    // Caught up and still reading: nothing has failed, so there is nothing to report about staleness.
    expect(indexer.status().lastError).toBeNull();

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

  it("commits each window, so a long backfill shows progress instead of nothing", async () => {
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n };
    const asked: [bigint, bigint][] = [];
    const source: LogSource = {
      head: vi.fn(async () => 250n),
      logs: vi.fn(async (q: LogQuery) => {
        if (q.event === REGISTERED) asked.push([q.fromBlock, q.toBlock ?? 0n]);
        return logsIn(q, [registeredLog(alice, 120n)]);
      }),
    };
    const indexer = new Indexer(source, MULTIPASS, 1n, { window: 100n });
    await indexer.tick();

    // Three windows of a hundred blocks, each committed: a restart resumes from the last one.
    expect(asked).toEqual([
      [1n, 100n],
      [101n, 200n],
      [201n, 250n],
    ]);
    expect(indexer.status()).toMatchObject({ indexedBlock: 250, records: 1 });
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

  it("stops polling at once, and waits for the loop to finish", async () => {
    // A shutdown should not sit through a whole interval, and nothing should still be ticking after it.
    const { source } = fakeSource(10n, []);
    const indexer = new Indexer(source, MULTIPASS, 1n);
    const loop = startIndexer(indexer, 3600);
    await vi.waitFor(() => expect(source.head).toHaveBeenCalled());
    const before = (source.head as ReturnType<typeof vi.fn>).mock.calls.length;
    await loop.stop();
    await new Promise((r) => setTimeout(r, 20));
    expect((source.head as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });

  it("survives an unreadable snapshot directory and a failing tick", async () => {
    // A directory under a regular file: mkdir fails with ENOTDIR at once, everywhere. `/proc/nope` used
    // to stand in for "unwritable", and on Linux that mkdir never returns at all.
    const notADir = join(mkdtempSync(join(tmpdir(), "ketsuban-index-")), "file");
    writeFileSync(notADir, "");
    const indexer = new Indexer(fakeSource(10n, []).source, MULTIPASS, 1n, {
      dataDir: join(notADir, "nope"),
    });
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
    // Awaited: a stop that only sets a flag leaves the loop running into the next test, and its timer
    // keeps the process alive after the file is done.
    await loop.stop();
    spy.mockRestore();
  });
});

/**
 * A health probe that cannot go wrong is not a health probe.
 *
 * `head` only moves inside a tick. Once the index has caught up, a source that starts failing leaves
 * `indexedBlock` equal to `head` and both frozen — so the old `synced` stayed true forever while the
 * chain moved on without it, and every list the product serves went quietly stale behind a service
 * still calling itself healthy.
 */
describe("an index that has stopped reading", () => {
  it("stops calling itself synced, and says what went wrong", async () => {
    let failing = false;
    const indexer = new Indexer(
      {
        head: async () => {
          if (failing) throw new Error("rpc: connection reset");
          return 100n;
        },
        logs: async () => [],
      } as never,
      0n
    );

    await indexer.tick();
    expect(indexer.status()).toMatchObject({ synced: true, lastError: null });

    failing = true;
    await expect(indexer.tick()).rejects.toThrow("connection reset");
    const stalled = indexer.status();
    // The numbers are unchanged and would still say "caught up" on their own.
    expect(stalled.indexedBlock).toBe(100);
    expect(stalled.head).toBe(100);
    expect(stalled.synced).toBe(false);
    expect(stalled.lastError).toMatch(/connection reset/);
    expect(stalled.staleForSeconds).toBeGreaterThanOrEqual(0);
  });

  it("goes back to synced once a read succeeds again", async () => {
    let failing = true;
    const indexer = new Indexer(
      {
        head: async () => {
          if (failing) throw new Error("rpc down");
          return 42n;
        },
        logs: async () => [],
      } as never,
      0n
    );

    await expect(indexer.tick()).rejects.toThrow("rpc down");
    expect(indexer.status().lastError).toMatch(/rpc down/);

    failing = false;
    await indexer.tick();
    expect(indexer.status()).toMatchObject({ synced: true, lastError: null });
  });
});

/**
 * A snapshot is read whole or not at all.
 *
 * One record that will not parse throws part-way through the loop. Keeping the block first and filling
 * the map as it went left the index believing it had read up to that block while holding only the
 * records before the bad one — so the rest never came back, and they were missing from every list with
 * nothing having visibly failed. Starting over from the deploy block is slow; being quietly incomplete
 * is worse.
 */
describe("restoring a damaged snapshot", () => {
  it("keeps none of it rather than the part before the damage", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ketsuban-index-bad-"));
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n, payload: "hi" };
    const bob: Rec = { domain: "kju-is", name: "bob", wallet: ALICE, nonce: 1n, payload: "hi" };
    const src = fakeSource(400n, [registeredLog(alice, 100n), registeredLog(bob, 110n)]);
    await new Indexer(src.source, MULTIPASS, 50n, { dataDir }).tick();

    // Damage exactly one record's number, as a truncated or hand-edited file would.
    const path = join(dataDir, "records.json");
    const snapshot = JSON.parse(readFileSync(path, "utf8")) as {
      indexedBlock: string;
      records: Record<string, { validUntil: string }>;
    };
    const keys = Object.keys(snapshot.records);
    expect(keys.length).toBe(2);
    snapshot.records[keys[1]].validUntil = "not a number";
    writeFileSync(path, JSON.stringify(snapshot));

    const after = new Indexer(fakeSource(400n, []).source, MULTIPASS, 50n, { dataDir });
    // Nothing kept, and the block not advanced: the history is read again rather than half-believed.
    expect(after.recordsByDomain("kju-is")).toEqual([]);
    expect(after.status().indexedBlock).toBe(49);
  });

  it("still resumes from a snapshot that is entirely sound", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ketsuban-index-ok-"));
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n, payload: "hi" };
    await new Indexer(fakeSource(400n, [registeredLog(alice, 100n)]).source, MULTIPASS, 50n, {
      dataDir,
    }).tick();

    const after = new Indexer(fakeSource(400n, []).source, MULTIPASS, 50n, { dataDir });
    expect(after.recordsByDomain("kju-is").map((r) => r.name)).toEqual(["alice"]);
    expect(after.status().indexedBlock).toBe(400);
  });
});

/**
 * Whether what the index holds would survive a restart.
 *
 * A volume that cannot be written costs nothing while the process lives — the index is in memory — and
 * everything at the next restart, when the whole history is read again from the deploy block and the
 * product is blank until it finishes. A log line that scrolled past hours ago is not where somebody
 * inspecting a deployment will find that out.
 */
describe("whether the index is durable", () => {
  it("says so when it has nowhere to write at all", async () => {
    const indexer = new Indexer(fakeSource(10n, []).source, MULTIPASS, 0n);
    await indexer.tick();
    expect(indexer.status().durable).toBe(false);
    expect(indexer.status().snapshotError).toBeNull();
  });

  it("says so, and why, when the write fails", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ketsuban-index-ro-"));
    const alice: Rec = { domain: "kju-is", name: "alice", wallet: ALICE, nonce: 1n, payload: "hi" };
    const indexer = new Indexer(fakeSource(400n, [registeredLog(alice, 100n)]).source, MULTIPASS, 50n, {
      dataDir,
    });
    await indexer.tick();
    expect(indexer.status().durable).toBe(true);

    // A directory where the snapshot file should be: the write fails the way a read-only or full
    // volume fails, without pretending the process cannot serve.
    rmSync(join(dataDir, "records.json"));
    mkdirSync(join(dataDir, "records.json"));
    await indexer.catchUp(500n);

    const status = indexer.status();
    expect(status.durable).toBe(false);
    expect(status.snapshotError).toBeTruthy();
    // Still reading: an index that cannot save is not an index that has stopped.
    expect(status.lastError).toBeNull();
    expect(indexer.recordsByDomain("kju-is").map((r) => r.name)).toEqual(["alice"]);
  });
});
