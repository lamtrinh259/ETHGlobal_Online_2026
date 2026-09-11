import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadShortlist, shortlist, unshortlist } from "@/lib/shortlist";

/**
 * The people one reader is checking.
 *
 * jsdom has no `localStorage` at all, so every one of these runs against a stub — which is also the
 * state a browser refusing storage is in, and the one the store has to survive.
 */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
});

describe("a reader's shortlist", () => {
  it("keeps who was added, newest first", () => {
    shortlist("alice", "backend role");
    const all = shortlist("bob");
    expect(all.map((s) => s.handle)).toEqual(["bob", "alice"]);
    expect(all[1].note).toBe("backend role");
    expect(loadShortlist().map((s) => s.handle)).toEqual(["bob", "alice"]);
  });

  it("holds one row per person, however many times they are added", () => {
    shortlist("alice", "first");
    const all = shortlist("ALICE", "second");
    expect(all).toHaveLength(1);
    expect(all[0].note).toBe("second");
  });

  it("takes somebody off it", () => {
    shortlist("alice");
    shortlist("bob");
    expect(unshortlist("ALICE").map((s) => s.handle)).toEqual(["bob"]);
  });

  it("refuses a name that is only whitespace, rather than holding an empty row", () => {
    expect(shortlist("   ")).toEqual([]);
  });

  it("reads nothing out of storage that is not a list of people", () => {
    store.set("ketsuban:shortlist", '{"not":"a list"}');
    expect(loadShortlist()).toEqual([]);
    store.set("ketsuban:shortlist", '["a string", {"handle": "alice"}]');
    expect(loadShortlist().map((s) => s.handle)).toEqual(["alice"]);
  });

  it("survives a browser that refuses storage entirely", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(loadShortlist()).toEqual([]);
    expect(() => shortlist("alice")).not.toThrow();
  });
});
