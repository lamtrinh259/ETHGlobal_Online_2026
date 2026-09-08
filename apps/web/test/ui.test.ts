import { describe, expect, it } from "vitest";
import { fmtUtc, short, waveChars } from "@/app/ui";

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

import { isActive } from "@/app/AppShell";

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
