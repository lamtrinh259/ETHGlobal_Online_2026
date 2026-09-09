import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PersistentMap, PersistentSet } from "../../src/store.js";

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
    const set = new PersistentSet("gas-topups", "/proc/nope");
    expect(() => set.add("0xalice")).not.toThrow();
    expect(set.has("0xalice")).toBe(true);
    expect(errors.some((e) => e.startsWith("store /proc/nope"))).toBe(true);
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
