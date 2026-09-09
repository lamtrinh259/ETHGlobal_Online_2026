import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
    } catch (err) {
      console.error(`store ${this.path} failed · ${(err as Error).message}`);
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
export class PersistentMap<T> {
  private readonly values = new Map<string, T>();
  private readonly path?: string;

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
    } catch (err) {
      console.error(`store ${this.path} failed · ${(err as Error).message}`);
    }
  }
}
