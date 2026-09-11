import { describe, expect, it, vi } from "vitest";

/**
 * The redirect a reader without JavaScript gets.
 *
 * Redirecting from inside the rendered page reaches the client as a 200 with an instruction to
 * navigate: a browser follows it and `curl`, a crawler or an agent does not. This product is read by
 * those, so the redirect is answered before anything renders.
 */
vi.stubEnv("NEXT_PUBLIC_PARENT_NAMES", "ketsuban.eth,kju-is.ketsuban.eth");
const { middleware } = await import("@/middleware");
const { NextRequest } = await import("next/server");

const go = (path: string) => middleware(new NextRequest(new URL(path, "https://ketsuban.peeramid.xyz")));

describe("a person's name goes to their page", () => {
  it("redirects a single label under the root, for real", () => {
    const res = go("/v/alice.ketsuban.eth");
    expect(res.status).toBe(308);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/p/alice");
  });

  it("carries the query, because a disclosure link is the reason somebody was sent one", () => {
    const res = go("/v/alice.ketsuban.eth?reveal=x&for=0xabc");
    expect(res.headers.get("location")).toContain("/p/alice?reveal=x&for=0xabc");
  });

  it("leaves every name that is not a person where it is", () => {
    // A reference written for alice, an account, a subject instance, and the root itself.
    for (const name of [
      "bob.alice.ketsuban.eth",
      "alice.com.x.www.ketsuban.eth",
      "kju-is.ketsuban.eth",
      "ketsuban.eth",
    ]) {
      expect(go(`/v/${name}`).status, name).toBe(200);
    }
  });
});
