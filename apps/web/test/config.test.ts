import { describe, expect, it } from "vitest";
import { loadWebConfig, siteUrl } from "@/lib/config";

/**
 * A preview is the production build served under a pull request's own host, and the API it belongs
 * to sits under the same id. The variables carry the production addresses; the platform's own
 * variable says which preview this is, and the config addresses the rest of the preview from it.
 */
const production = {
  NEXT_PUBLIC_PRIVY_APP_ID: "app",
  NEXT_PUBLIC_PRIVY_CLIENT_ID: "client",
  NEXT_PUBLIC_API_URL: "https://ketsuban-api.peeramid.xyz",
  NEXT_PUBLIC_ATTEST_URL: "https://ketsuban-api.peeramid.xyz",
  NEXT_PUBLIC_SITE_URL: "https://ketsuban.peeramid.xyz",
  NEXT_PUBLIC_CHAIN_ID: "11155111",
  NEXT_PUBLIC_MULTIPASS: "0x418f82fd0014a4ca402f145978bfaf0555a9ca06",
  NEXT_PUBLIC_NAME_DOMAINS: "ketsuban,kju-is",
  NEXT_PUBLIC_PARENT_NAMES: "ketsuban.eth,kju-is.ketsuban.eth",
};

describe("where the app is served, and which API it talks to", () => {
  it("talks to the production API in production", () => {
    const c = loadWebConfig(production);
    expect(c.apiUrl).toBe("https://ketsuban-api.peeramid.xyz");
    expect(c.attestUrl).toBe("https://ketsuban-api.peeramid.xyz");
    expect(c.confidential).toBe(false);
    expect(siteUrl(production)).toBe("https://ketsuban.peeramid.xyz");
  });

  it("talks to the preview's own API where the platform says this is a preview", () => {
    const preview = { ...production, COOLIFY_FQDN: "1.ketsuban.peeramid.xyz" };
    const c = loadWebConfig(preview);
    expect(c.apiUrl).toBe("https://1.ketsuban-api.peeramid.xyz");
    expect(c.attestUrl).toBe("https://1.ketsuban-api.peeramid.xyz");
    // Same origin either side of the id: still not a confidential attester.
    expect(c.confidential).toBe(false);
    expect(siteUrl(preview)).toBe("https://1.ketsuban.peeramid.xyz");
  });

  it("reads the preview from COOLIFY_URL too, with its scheme", () => {
    const c = loadWebConfig({ ...production, COOLIFY_URL: "https://12.ketsuban.peeramid.xyz" });
    expect(c.apiUrl).toBe("https://12.ketsuban-api.peeramid.xyz");
  });

  it("keeps a separate attester separate, in the same preview", () => {
    const c = loadWebConfig({
      ...production,
      NEXT_PUBLIC_ATTEST_URL: "https://attest.example",
      COOLIFY_FQDN: "1.ketsuban.peeramid.xyz",
    });
    expect(c.attestUrl).toBe("https://1.attest.example");
    expect(c.confidential).toBe(true);
  });
});
