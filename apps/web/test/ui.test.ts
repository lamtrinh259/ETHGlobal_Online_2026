import { describe, expect, it } from "vitest";
import { buildStamp, fmtUtc, short, waveChars } from "@/app/ui";

describe("ui helpers", () => {
  it("shortens hex, leaves short strings alone", () => {
    expect(short("0xEE4811b9462956C9C3535E79c08776D769CA9F3a")).toBe("0xEE48…9F3a");
    expect(short("0xabc")).toBe("0xabc");
  });
  it("formats UTC without seconds and tolerates junk", () => {
    expect(fmtUtc("2026-10-08T09:14:22.000Z")).toBe("2026-10-08 09:14Z");
    expect(fmtUtc(null)).toBe("—");
    expect(fmtUtc("nope")).toBe("—");
  });
  it("staggers the wordmark", () => {
    expect(waveChars("ab")).toEqual([
      { ch: "a", delay: "0ms" },
      { ch: "b", delay: "70ms" },
    ]);
  });
});

import { apiMisconfigured, isActive } from "@/app/AppShell";

describe("nav", () => {
  it("marks each door on its routes; verify owns /p and /v", () => {
    expect(isActive("/claim", "/claim")).toBe(true);
    expect(isActive("/vouch/alice", "/vouch")).toBe(true);
    expect(isActive("/p/alice", "/verify")).toBe(true);
    expect(isActive("/v/x.eth", "/verify")).toBe(true);
    expect(isActive("/me", "/me")).toBe(true);
    expect(isActive("/", "/claim")).toBe(false);
    expect(isActive("/claim", "/vouch")).toBe(false);
  });
});

describe("apiMisconfigured", () => {
  it("flags a loopback API on a public origin only", () => {
    expect(apiMisconfigured("http://127.0.0.1:8787", "https://ketsuban-app.peeramid.xyz")).toBe(true);
    expect(apiMisconfigured("http://localhost:8787", "https://x.example")).toBe(true);
    expect(apiMisconfigured("http://127.0.0.1:8787", "http://localhost:3000")).toBe(false);
    expect(apiMisconfigured("http://127.0.0.1:8787", "")).toBe(false);
    expect(apiMisconfigured("https://ketsuban.peeramid.xyz", "https://ketsuban-app.peeramid.xyz")).toBe(
      false
    );
  });
});

describe("buildStamp", () => {
  it("names the commit and the time, and copes when either is missing", () => {
    expect(buildStamp("a1b2c3d", "2026-09-09 12:30Z")).toBe("build a1b2c3d · 2026-09-09 12:30Z");
    // A gitless build context has no commit; a stamp is still better than nothing.
    expect(buildStamp("", "2026-09-09 12:30Z")).toBe("build 2026-09-09 12:30Z");
    expect(buildStamp("a1b2c3d")).toBe("build a1b2c3d");
    expect(buildStamp()).toBe("build unknown");
    expect(buildStamp("  ", "  ")).toBe("build unknown");
  });
});
