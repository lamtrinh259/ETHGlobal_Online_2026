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
