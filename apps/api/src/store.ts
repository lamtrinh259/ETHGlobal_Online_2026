import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * A set that survives a restart. The gas top-up is "once per wallet", and a set held only in memory
 * makes that "once per process": every deploy hands the same wallets another payout.
 *
 * Backed by one JSON file, written atomically. Without a directory it stays in memory, which is what
 * the tests and a stateless deployment want.
 */
export class PersistentSet {
  private readonly values: Set<string>;
  private readonly path?: string;
  private failure: string | null = null;

  constructor(name: string, dataDir?: string) {
    this.path = dataDir ? join(dataDir, `${name}.json`) : undefined;
    this.values = new Set(this.restore());
  }

  has(value: string): boolean {
    return this.values.has(value);
  }

  add(value: string): void {
    if (this.values.has(value)) return;
    this.values.add(value);
    this.persist();
  }

  /**
   * Give a claim back.
   *
   * A set like this is often claimed before the thing it stands for is done, so two requests in flight
   * cannot both spend it. That is only correct if a failure releases it again — otherwise one bad
   * moment denies somebody the single chance they had.
   */
  delete(value: string): void {
    if (this.values.delete(value)) this.persist();
  }

  /** Whether what this set holds would survive a restart; see PersistentMap.health. */
  health(): StoreHealth {
    if (!this.path) return { durable: false, writable: false, lastError: null };
    return { durable: true, writable: this.failure === null, lastError: this.failure };
  }

  get size(): number {
    return this.values.size;
  }

  private restore(): string[] {
    if (!this.path) return [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
    } catch {
      // no file yet, or an unreadable one: start empty rather than refuse to boot
      return [];
    }
  }

  private persist(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.values]));
      renameSync(tmp, this.path);
      this.failure = null;
    } catch (err) {
      this.failure = (err as Error).message;
      console.error(`store ${this.path} failed · ${this.failure}`);
    }
  }
}

/**
 * A string-keyed map that survives a restart, written atomically as one JSON file.
 *
 * A read permission has to outlive a redeploy: a candidate signs one and hands over a link, and that
 * link must keep working. Keeping the grants in memory and only their keys on disk is worse than either
 * choice alone — the service would claim a permission exists and then fail to open it.
 */
/** Whether what this store holds would survive a restart, and why not when it would not. */
/**
 * What a deployment with no `DATA_DIR` is about to lose, in one sentence.
 *
 * It is said twice — once at boot, once from preflight — and an operator reads whichever they hit
 * first, so both read it from here. The letters are the sharpest of these: a reference puts only
 * `sha256:…` on chain, permanently, and the text exists nowhere but this directory.
 */
export const VOLATILE_WITHOUT_DATA_DIR =
  "reference letters, permissions, invitations, the one-human-one-account binding and gas top-ups are kept in memory and lost on restart";

export type StoreHealth = { durable: boolean; writable: boolean; lastError: string | null };

/**
 * Can this service actually keep anything. Worth asking at boot rather than at the first write: a
 * `DATA_DIR` with no volume behind it fails silently, and the loss only shows up as permissions
 * disappearing after a redeploy.
 */
export function probeStorage(dataDir: string | undefined): StoreHealth {
  if (!dataDir) return { durable: false, writable: false, lastError: null };
  const probe = join(dataDir, ".probe");
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(probe, "");
    rmSync(probe, { force: true });
    return { durable: true, writable: true, lastError: null };
  } catch (err) {
    return { durable: true, writable: false, lastError: (err as Error).message };
  }
}

export class PersistentMap<T> {
  private readonly values = new Map<string, T>();
  private readonly path?: string;
  private failure: string | null = null;

  constructor(
    name: string,
    dataDir: string | undefined,
    private readonly revive: (raw: unknown) => T,
    private readonly replace: (value: T) => unknown
  ) {
    this.path = dataDir ? join(dataDir, `${name}.json`) : undefined;
    this.restore();
  }

  get(key: string): T | undefined {
    return this.values.get(key);
  }

  set(key: string, value: T): void {
    this.values.set(key, value);
    this.persist();
  }

  delete(key: string): void {
    if (this.values.delete(key)) this.persist();
  }

  /** Every stored value, for endpoints that answer about a set rather than one key. */
  entries(): [string, T][] {
    return [...this.values.entries()];
  }

  /**
   * A failed write leaves the value usable in this process and gone at the next restart, which is the
   * worst way for storage to break: everything looks fine until the service is redeployed. Saying so
   * here lets `/healthz` answer the question rather than leaving it in a log nobody reads.
   */
  health(): StoreHealth {
    if (!this.path) return { durable: false, writable: false, lastError: null };
    return { durable: true, writable: this.failure === null, lastError: this.failure };
  }

  get size(): number {
    return this.values.size;
  }

  private restore(): void {
    if (!this.path) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object") return;
      for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
        try {
          this.values.set(key, this.revive(raw));
        } catch {
          // one unreadable entry must not cost the rest
        }
      }
    } catch {
      // no file yet, or an unreadable one
    }
  }

  private persist(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      const out: Record<string, unknown> = {};
      for (const [key, value] of this.values) out[key] = this.replace(value);
      writeFileSync(tmp, JSON.stringify(out));
      renameSync(tmp, this.path);
      this.failure = null;
    } catch (err) {
      this.failure = (err as Error).message;
      console.error(`store ${this.path} failed · ${this.failure}`);
    }
  }
}
