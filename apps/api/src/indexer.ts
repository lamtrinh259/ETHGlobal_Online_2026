import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAbiItem, type Address, type Hex } from "viem";
import { MultipassAbi, fromBytes32 } from "@peeramid-labs/multipass-client";
import { decodeLogs, type LogSource } from "./logs.js";

export type IndexedRecord = {
  domain: string;
  domainName: Hex;
  id: Hex;
  name: string;
  wallet: Address;
  payload: Hex;
  validUntil: bigint;
  nonce: bigint;
  /** Block of the log that last changed this record */
  block: bigint;
};

export type IndexStatus = { indexedBlock: number; head: number; records: number; synced: boolean };

export interface RecordIndex {
  recordsByDomain(domain: string): IndexedRecord[];
  recordsByWallet(wallet: Address): IndexedRecord[];
  status(): IndexStatus;
}

const REGISTERED = getAbiItem({ abi: MultipassAbi, name: "Registered" });
const RENEWED = getAbiItem({ abi: MultipassAbi, name: "Renewed" });
const DELETED = getAbiItem({ abi: MultipassAbi, name: "nameDeleted" });

type Snapshot = { indexedBlock: string; records: Record<string, SerialisedRecord> };
type SerialisedRecord = Omit<IndexedRecord, "validUntil" | "nonce" | "block"> & {
  validUntil: string;
  nonce: string;
  block: string;
};

const key = (domainName: Hex, id: Hex) => `${domainName.toLowerCase()}:${id.toLowerCase()}`;

/**
 * Multipass records, kept current by tailing the three events that change them
 * (`Registered`, `Renewed`, `nameDeleted`). Queries never touch the chain: a public `eth_getLogs`
 * over the whole history is unreliable, so the history is read once, in windows, and persisted.
 *
 * Deliberately in-process: one container, one volume, no second service to deploy.
 */
export class Indexer implements RecordIndex {
  private records = new Map<string, IndexedRecord>();
  private indexedBlock: bigint;
  private headBlock = 0n;
  private queue: Promise<number> = Promise.resolve(0);
  private readonly snapshotPath?: string;
  /** Blocks per committed step; a long backfill is many of these rather than one silent sweep. */
  private readonly window: bigint;

  constructor(
    private readonly source: LogSource,
    private readonly multipass: Address,
    private readonly deployBlock: bigint,
    opts: { dataDir?: string; window?: bigint } = {}
  ) {
    this.window = opts.window ?? 50_000n;
    this.indexedBlock = deployBlock > 0n ? deployBlock - 1n : 0n;
    this.snapshotPath = opts.dataDir ? join(opts.dataDir, "records.json") : undefined;
    this.restore();
  }

  /**
   * Read new blocks. Ticks are serialised: a poll and a post-transaction catch-up that overlap would
   * otherwise race on `indexedBlock` and skip the window one of them had already claimed.
   */
  tick(): Promise<number> {
    const run = () => this.runTick();
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /**
   * Index at least up to `block`, rescanning it even if the cursor has passed it. A transaction this
   * service just sent must be queryable on the next request, whatever a concurrent poll claimed.
   */
  catchUp(block: bigint): Promise<number> {
    const run = () => this.runTick(block);
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  private async runTick(include?: bigint): Promise<number> {
    const head = await this.source.head();
    this.headBlock = head > this.headBlock ? head : this.headBlock;
    const to = include && include > head ? include : head;
    const from = include && include <= this.indexedBlock ? include : this.indexedBlock + 1n;
    if (from > to) return 0;

    // Walk the range in windows, committing each one. A first run over a long history is otherwise a
    // single tick that publishes nothing until it finishes and starts over after any restart.
    let changed = 0;
    for (let start = from; start <= to; start += this.window) {
      const end = start + this.window - 1n > to ? to : start + this.window - 1n;
      changed += await this.scan(start, end);
    }
    return changed;
  }

  private async scan(from: bigint, to: bigint): Promise<number> {
    const [registered, renewed, deleted] = await Promise.all([
      this.source.logs({ address: this.multipass, event: REGISTERED, fromBlock: from, toBlock: to }),
      this.source.logs({ address: this.multipass, event: RENEWED, fromBlock: from, toBlock: to }),
      this.source.logs({ address: this.multipass, event: DELETED, fromBlock: from, toBlock: to }),
    ]);
    type Change = { block: bigint; apply: () => void };
    const changes: Change[] = [];
    for (const l of decodeLogs<{ domainName: Hex; NewRecord: RawRecord }>(REGISTERED, registered)) {
      changes.push({ block: l.blockNumber, apply: () => this.put(l.domainName, l.NewRecord, l.blockNumber) });
    }
    for (const l of decodeLogs<{ domainName: Hex; newRecord: RawRecord }>(RENEWED, renewed)) {
      changes.push({ block: l.blockNumber, apply: () => this.put(l.domainName, l.newRecord, l.blockNumber) });
    }
    for (const l of decodeLogs<{ domainName: Hex; id: Hex }>(DELETED, deleted)) {
      changes.push({ block: l.blockNumber, apply: () => void this.records.delete(key(l.domainName, l.id)) });
    }
    changes.sort((a, b) => Number(a.block - b.block));
    for (const c of changes) c.apply();
    this.indexedBlock = to > this.indexedBlock ? to : this.indexedBlock;
    this.persist();
    return changes.length;
  }

  recordsByDomain(domain: string): IndexedRecord[] {
    return [...this.records.values()]
      .filter((r) => r.domain === domain)
      .sort((a, b) => Number(b.validUntil - a.validUntil));
  }

  recordsByWallet(wallet: Address): IndexedRecord[] {
    const w = wallet.toLowerCase();
    return [...this.records.values()].filter((r) => r.wallet.toLowerCase() === w);
  }

  status(): IndexStatus {
    return {
      indexedBlock: Number(this.indexedBlock),
      head: Number(this.headBlock),
      records: this.records.size,
      synced: this.headBlock > 0n && this.indexedBlock >= this.headBlock,
    };
  }

  private put(domainName: Hex, rec: RawRecord, block: bigint) {
    const k = key(domainName, rec.id);
    const current = this.records.get(k);
    // Logs arrive in block order, but a reorg or a replayed window must never move a record backwards.
    if (current && (current.nonce > rec.nonce || (current.nonce === rec.nonce && current.block > block)))
      return;
    this.records.set(k, {
      domain: fromBytes32(domainName),
      domainName,
      id: rec.id,
      name: fromBytes32(rec.name),
      wallet: rec.wallet,
      payload: rec.payload,
      validUntil: rec.validUntil,
      nonce: rec.nonce,
      block,
    });
  }

  private persist() {
    if (!this.snapshotPath) return;
    const snapshot: Snapshot = {
      indexedBlock: this.indexedBlock.toString(),
      records: Object.fromEntries(
        [...this.records.entries()].map(([k, r]) => [
          k,
          { ...r, validUntil: r.validUntil.toString(), nonce: r.nonce.toString(), block: r.block.toString() },
        ])
      ),
    };
    try {
      mkdirSync(dirname(this.snapshotPath), { recursive: true });
      const tmp = `${this.snapshotPath}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot));
      renameSync(tmp, this.snapshotPath);
    } catch (err) {
      console.error(`index snapshot failed · ${(err as Error).message}`);
    }
  }

  private restore() {
    if (!this.snapshotPath) return;
    try {
      const snapshot = JSON.parse(readFileSync(this.snapshotPath, "utf8")) as Snapshot;
      const block = BigInt(snapshot.indexedBlock);
      if (block < this.indexedBlock) return; // snapshot predates this deployment's start block
      this.indexedBlock = block;
      for (const [k, r] of Object.entries(snapshot.records)) {
        this.records.set(k, {
          ...r,
          validUntil: BigInt(r.validUntil),
          nonce: BigInt(r.nonce),
          block: BigInt(r.block),
        });
      }
    } catch {
      // no snapshot yet, or an unreadable one: the history is read again from the deploy block
    }
  }
}

type RawRecord = {
  wallet: Address;
  name: Hex;
  id: Hex;
  nonce: bigint;
  domainName: Hex;
  validUntil: bigint;
  payload: Hex;
};

/** Poll forever; a failed tick is logged and retried on the next interval. */
export function startIndexer(indexer: Indexer, everySeconds: number): { stop: () => void } {
  let stopped = false;
  const run = async () => {
    while (!stopped) {
      try {
        const changed = await indexer.tick();
        if (changed) console.log(JSON.stringify({ msg: "indexed", changed, ...indexer.status() }));
      } catch (err) {
        console.error(`index tick failed · ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, everySeconds * 1000));
    }
  };
  void run();
  return { stop: () => void (stopped = true) };
}
