import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PersistentSet } from "../../src/store.js";

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
