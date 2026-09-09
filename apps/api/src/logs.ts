import { decodeEventLog, type AbiEvent, type Address, type Hex, type PublicClient } from "viem";

/** One log, in the shape both sources produce and the decoder consumes. */
export type RawLog = { blockNumber: bigint; logIndex: number; topics: Hex[]; data: Hex };

export type LogQuery = {
  address: Address;
  event: AbiEvent;
  /** Indexed values to match, position by position; `null` matches anything. */
  topics?: (Hex | null)[];
  fromBlock: bigint;
  /** Last block to read; the chain head when omitted. */
  toBlock?: bigint;
};

export interface LogSource {
  logs(q: LogQuery): Promise<RawLog[]>;
  /** Chain head, so a tailer knows how far it has read. */
  head(): Promise<bigint>;
}

/**
 * `eth_getLogs` in windows, halving the window on failure. Providers cap the range (and silently
 * truncate wide ones), so the range is always explicit and every window is retried smaller.
 */
export class RpcSource implements LogSource {
  constructor(
    private readonly client: Pick<PublicClient, "getLogs" | "getBlockNumber">,
    private readonly window = 10_000n,
    private readonly minWindow = 500n
  ) {}

  head(): Promise<bigint> {
    return this.client.getBlockNumber();
  }

  async logs(q: LogQuery): Promise<RawLog[]> {
    const head = q.toBlock ?? (await this.client.getBlockNumber());
    const out: RawLog[] = [];
    let from = q.fromBlock;
    let window = this.window;
    while (from <= head) {
      const to = from + window - 1n > head ? head : from + window - 1n;
      try {
        const logs = await this.client.getLogs({
          address: q.address,
          event: q.event,
          fromBlock: from,
          toBlock: to,
        } as Parameters<PublicClient["getLogs"]>[0]);
        for (const l of logs as unknown as {
          blockNumber: bigint;
          logIndex: number;
          topics: Hex[];
          data: Hex;
        }[]) {
          out.push({ blockNumber: l.blockNumber, logIndex: l.logIndex, topics: l.topics, data: l.data });
        }
        from = to + 1n;
        window = window * 2n > this.window ? this.window : window * 2n;
      } catch (err) {
        if (window <= this.minWindow) throw err;
        window = window / 2n > this.minWindow ? window / 2n : this.minWindow;
      }
    }
    return out.filter((l) => matches(l, q.topics));
  }
}

function matches(log: RawLog, topics?: (Hex | null)[]): boolean {
  if (!topics?.length) return true;
  return topics.every((t, i) => !t || log.topics[i + 1]?.toLowerCase() === t.toLowerCase());
}

/** Decode a source's logs with the event ABI, dropping anything that does not fit. */
export function decodeLogs<T>(event: AbiEvent, logs: RawLog[]): (T & { blockNumber: bigint })[] {
  const out: (T & { blockNumber: bigint })[] = [];
  for (const l of logs) {
    try {
      const { args } = decodeEventLog({ abi: [event], topics: l.topics as [Hex, ...Hex[]], data: l.data });
      out.push({ ...(args as T), blockNumber: l.blockNumber });
    } catch {
      // a log that does not match this event's shape is not ours
    }
  }
  return out;
}
