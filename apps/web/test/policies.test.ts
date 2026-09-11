import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPolicy, loadPolicies, savePolicy } from "@/lib/policies";
import { DEFAULT_POLICY } from "@/lib/profile";

/**
 * The presets are the platform's. A verifier's own bar is theirs, and rebuilding it for every
 * candidate is how the fields end up different between one and the next.
 */
/**
 * jsdom here ships no `localStorage`, which is also a real browser state — a private window, or site
 * data blocked. So the store is supplied, and one case takes it away again.
 */
function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe("a verifier's own policies", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", fakeStorage());
  });

  it("keeps one and reads it back", () => {
    savePolicy({ name: "Our bar", policy: { ...DEFAULT_POLICY, minVouches: 5 } });
    expect(loadPolicies()).toEqual([{ name: "Our bar", policy: { ...DEFAULT_POLICY, minVouches: 5 } }]);
  });

  it("replaces one saved under the same name, which is what editing looks like", () => {
    savePolicy({ name: "Our bar", policy: { ...DEFAULT_POLICY, minVouches: 5 } });
    savePolicy({ name: "Our bar", policy: { ...DEFAULT_POLICY, minVouches: 2 } });
    expect(loadPolicies()).toHaveLength(1);
    expect(loadPolicies()[0].policy.minVouches).toBe(2);
  });

  it("forgets one by name", () => {
    savePolicy({ name: "a", policy: DEFAULT_POLICY });
    savePolicy({ name: "b", policy: DEFAULT_POLICY });
    expect(forgetPolicy("a").map((p) => p.name)).toEqual(["b"]);
  });

  it("survives a browser with no storage at all, rather than taking the page with it", () => {
    // A private window, blocked site data, or a server render: all of them, and a verifier mid-check.
    vi.unstubAllGlobals();
    expect(loadPolicies()).toEqual([]);
    expect(() => savePolicy({ name: "x", policy: DEFAULT_POLICY })).not.toThrow();
  });

  it("ignores something else's value under the same key", () => {
    localStorage.setItem("ketsuban:policies", '{"not":"an array"}');
    expect(loadPolicies()).toEqual([]);
  });
});
