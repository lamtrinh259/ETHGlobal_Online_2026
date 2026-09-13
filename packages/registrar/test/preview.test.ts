import { describe, expect, it } from "vitest";
import { forPreview, previewId } from "../src/preview.js";

/**
 * A preview is a pull request's own copy of both deployments. What the web app is configured with is
 * the production API; what it must talk to is the preview's. The id in front of its own host says
 * which preview it is, and the same id goes in front of the other host.
 */
describe("which preview a host serves", () => {
  it("is the first label where that label is a number", () => {
    expect(previewId("1.shibboleth.peeramid.xyz")).toBe("1");
    expect(previewId("12.shibboleth-api.peeramid.xyz")).toBe("12");
  });

  it("reads the same through a scheme, a path or a port", () => {
    expect(previewId("https://7.shibboleth.peeramid.xyz/")).toBe("7");
    expect(previewId("http://7.shibboleth.peeramid.xyz:3000")).toBe("7");
  });

  it("is nothing for production, for a bare number, or for no host at all", () => {
    expect(previewId("shibboleth.peeramid.xyz")).toBeUndefined();
    expect(previewId("api.shibboleth.peeramid.xyz")).toBeUndefined();
    expect(previewId("1")).toBeUndefined();
    expect(previewId("")).toBeUndefined();
    expect(previewId(undefined)).toBeUndefined();
  });
});

describe("the other deployment's address in the same preview", () => {
  it("puts the preview id in front of the host, keeping scheme, port and path", () => {
    expect(forPreview("https://shibboleth-api.peeramid.xyz", "1.shibboleth.peeramid.xyz")).toBe(
      "https://1.shibboleth-api.peeramid.xyz"
    );
    expect(forPreview("https://shibboleth.peeramid.xyz/", "1.shibboleth-api.peeramid.xyz")).toBe(
      "https://1.shibboleth.peeramid.xyz/"
    );
    expect(forPreview("http://attest.example:8080/v1", "3.shibboleth.peeramid.xyz")).toBe(
      "http://3.attest.example:8080/v1"
    );
  });

  it("leaves the address alone where there is no preview, or it already carries the id", () => {
    expect(forPreview("https://shibboleth-api.peeramid.xyz", "shibboleth.peeramid.xyz")).toBe(
      "https://shibboleth-api.peeramid.xyz"
    );
    expect(forPreview("https://shibboleth-api.peeramid.xyz", undefined)).toBe(
      "https://shibboleth-api.peeramid.xyz"
    );
    expect(forPreview("https://1.shibboleth-api.peeramid.xyz", "1.shibboleth.peeramid.xyz")).toBe(
      "https://1.shibboleth-api.peeramid.xyz"
    );
  });

  it("leaves something that is not a URL alone rather than inventing an address", () => {
    expect(forPreview("*", "1.shibboleth.peeramid.xyz")).toBe("*");
    expect(forPreview("", "1.shibboleth.peeramid.xyz")).toBe("");
  });
});
