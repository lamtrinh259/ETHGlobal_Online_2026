import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PersistentMap, PersistentSet, probeStorage } from "../../src/store.js";

describe("PersistentSet", () => {
  it("remembers across a restart, which is what makes 'once per wallet' true", () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-store-"));
    const first = new PersistentSet("gas-topups", dir);
    first.add("0xalice");
    first.add("0xalice");
    expect(first.size).toBe(1);

    const afterRestart = new PersistentSet("gas-topups", dir);
    expect(afterRestart.has("0xalice")).toBe(true);
    expect(afterRestart.has("0xbob")).toBe(false);
  });

  it("stays in memory with no directory, and survives an unreadable file", () => {
    const memory = new PersistentSet("gas-topups");
    memory.add("0xalice");
    expect(memory.has("0xalice")).toBe(true);
    expect(new PersistentSet("gas-topups").has("0xalice")).toBe(false);

    const dir = mkdtempSync(join(tmpdir(), "ketsuban-store-"));
    writeFileSync(join(dir, "gas-topups.json"), "{not json");
    expect(new PersistentSet("gas-topups", dir).size).toBe(0);
    writeFileSync(join(dir, "gas-topups.json"), JSON.stringify(["0xalice", 42]));
    expect(new PersistentSet("gas-topups", dir).size).toBe(1);
  });

  it("reports a write it could not make rather than throwing at the caller", () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((m) => void errors.push(String(m)));
    // A directory under a regular file: mkdir fails with ENOTDIR at once, everywhere. A path under
    // `/proc` looks the same and is not — on Linux that mkdir never returns.
    const file = join(mkdtempSync(join(tmpdir(), "ketsuban-store-")), "file");
    writeFileSync(file, "");
    const unwritable = join(file, "nope");
    const set = new PersistentSet("gas-topups", unwritable);
    expect(() => set.add("0xalice")).not.toThrow();
    expect(set.has("0xalice")).toBe(true);
    expect(errors.some((e) => e.startsWith(`store ${unwritable}`))).toBe(true);
    spy.mockRestore();
  });
});

describe("PersistentMap", () => {
  const revive = (raw: unknown) => {
    const r = raw as { exp: string; note: string };
    return { exp: BigInt(r.exp), note: r.note };
  };
  const replace = (v: { exp: bigint; note: string }) => ({ exp: v.exp.toString(), note: v.note });

  it("keeps its values across a restart, bigints included", () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-map-"));
    const first = new PersistentMap("disclosures", dir, revive, replace);
    first.set("alice.ketsuban.eth:x", { exp: 1_800_000_000n, note: "open" });
    expect(first.size).toBe(1);

    // A read permission must outlive a redeploy: the link a candidate handed over still works.
    const afterRestart = new PersistentMap("disclosures", dir, revive, replace);
    expect(afterRestart.get("alice.ketsuban.eth:x")).toEqual({ exp: 1_800_000_000n, note: "open" });
    expect(afterRestart.get("nobody:x")).toBeUndefined();

    afterRestart.delete("alice.ketsuban.eth:x");
    expect(new PersistentMap("disclosures", dir, revive, replace).size).toBe(0);
  });

  it("drops one unreadable entry rather than the whole file, and works with no directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-map-"));
    writeFileSync(
      join(dir, "disclosures.json"),
      JSON.stringify({ good: { exp: "1", note: "ok" }, bad: { exp: "not a number", note: "x" } })
    );
    const loaded = new PersistentMap("disclosures", dir, revive, replace);
    expect(loaded.size).toBe(1);
    expect(loaded.get("good")).toEqual({ exp: 1n, note: "ok" });

    const memory = new PersistentMap("disclosures", undefined, revive, replace);
    memory.set("a", { exp: 2n, note: "b" });
    expect(memory.get("a")?.exp).toBe(2n);
    expect(new PersistentMap("disclosures", undefined, revive, replace).size).toBe(0);
  });
});

describe("when the disk will not take it", () => {
  it("reports the failure instead of only logging it, so a lost write is visible", () => {
    // A directory that cannot exist: DATA_DIR pointing at a path with no volume behind it behaves the
    // same way, and every grant written there is gone at the next restart with nothing to show for it.
    const file = join(mkdtempSync(join(tmpdir(), "ketsuban-store-")), "a-file");
    writeFileSync(file, "not a directory");
    const map = new PersistentMap<{ v: number }>(
      "grants",
      join(file, "nope"),
      (raw) => raw as { v: number },
      (value) => value
    );

    expect(map.health().writable).toBe(true);
    map.set("k", { v: 1 });
    // The value is still usable in this process; what is gone is any chance of it surviving a restart.
    expect(map.get("k")).toEqual({ v: 1 });
    expect(map.health().writable).toBe(false);
    expect(map.health().lastError).toMatch(/ENOTDIR|ENOENT|EACCES/);
  });

  it("says a store with nowhere to write was never durable in the first place", () => {
    const map = new PersistentMap<{ v: number }>(
      "grants",
      undefined,
      (raw) => raw as { v: number },
      (value) => value
    );
    expect(map.health()).toEqual({ durable: false, writable: false, lastError: null });
  });
});

describe("probing storage before anything depends on it", () => {
  it("tells a writable directory from one that only looks like a path", () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-probe-"));
    expect(probeStorage(dir)).toEqual({ durable: true, writable: true, lastError: null });

    const file = join(dir, "a-file");
    writeFileSync(file, "not a directory");
    const bad = probeStorage(join(file, "nope"));
    expect(bad.durable).toBe(true);
    expect(bad.writable).toBe(false);
    expect(bad.lastError).toMatch(/ENOTDIR|ENOENT|EACCES/);

    expect(probeStorage(undefined)).toEqual({ durable: false, writable: false, lastError: null });
  });

  it("leaves nothing behind, because a probe is not data", () => {
    const dir = mkdtempSync(join(tmpdir(), "ketsuban-probe-clean-"));
    probeStorage(dir);
    expect(readdirSync(dir)).toEqual([]);
  });
});
