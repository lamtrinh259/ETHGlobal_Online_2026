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
  it("marks publish on the landing and verify on any name", () => {
    expect(isActive("/", "/")).toBe(true);
    expect(isActive("/v/x.eth", "/")).toBe(false);
    expect(isActive("/v/x.eth", "/v/alice.ketsuban.eth")).toBe(true);
    expect(isActive("/", "/v/alice.ketsuban.eth")).toBe(false);
  });
});
