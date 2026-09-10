import { describe, expect, it } from "vitest";
import { COMMIT_VARS, commitFromEnv } from "../../src/commit.js";

/**
 * Which commit is serving.
 *
 * A container built from an archive has no git to ask, so the answer comes from the environment. With
 * no answer at all, "is my fix deployed?" can only be settled by poking the service and inferring from
 * how it behaves — which is exactly when somebody is already unsure what they are looking at.
 */
describe("the commit this service reports", () => {
  it("takes the first name it finds, shortened to something a person can compare", () => {
    expect(commitFromEnv({ SOURCE_COMMIT: "e791cbef1883e7d8acb0b9d3bd3f5c57f3c0dacd" })).toEqual({
      sha: "e791cbe",
      from: "SOURCE_COMMIT",
    });
  });

  it("names the variable that carried it, so an unread name differs from an absent one", () => {
    expect(commitFromEnv({ GITHUB_SHA: "abcdef1234567" })).toEqual({ sha: "abcdef1", from: "GITHUB_SHA" });
  });

  it("prefers the earlier name when a platform sets several", () => {
    expect(commitFromEnv({ SOURCE_COMMIT: "1111111aaa", GITHUB_SHA: "2222222bbb" }).sha).toBe("1111111");
  });

  it("treats an exported but empty variable as no answer", () => {
    // The common shape: a platform exports the name and leaves it unset.
    expect(commitFromEnv({ SOURCE_COMMIT: "" }).from).toBe("none");
    expect(commitFromEnv({ SOURCE_COMMIT: "  " }).from).toBe("none");
  });

  it("answers none when nothing names a commit", () => {
    expect(commitFromEnv({})).toEqual({ sha: "", from: "none" });
  });

  it("reads the same names the web does, which is read at a different moment", () => {
    expect([...COMMIT_VARS]).toEqual([
      "SOURCE_COMMIT",
      "GIT_SHA",
      "GIT_COMMIT_SHA",
      "COMMIT_SHA",
      "GITHUB_SHA",
    ]);
  });
});
