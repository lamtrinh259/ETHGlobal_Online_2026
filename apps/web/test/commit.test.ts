import { describe, expect, it } from "vitest";
import { COMMIT_VARS, commitFromEnv } from "@/lib/commit";

/**
 * Which commit is serving.
 *
 * The build stamp is inlined at `next build`, so a platform that names the commit only at run time
 * leaves it empty — and then nothing on the deployment can say what it is running, which is exactly
 * when somebody most wants to know.
 */
describe("the commit the environment names", () => {
  it("takes the first name it finds, shortened", () => {
    expect(commitFromEnv({ SOURCE_COMMIT: "e791cbef1883e7d8acb0b9d3bd3f5c57f3c0dacd" })).toEqual({
      sha: "e791cbe",
      from: "SOURCE_COMMIT",
    });
  });

  it("says which variable carried it, so an unread name can be told from an absent one", () => {
    expect(commitFromEnv({ GITHUB_SHA: "abcdef1234567" }).from).toBe("GITHUB_SHA");
  });

  it("prefers the earlier name when a platform sets several", () => {
    const both = { SOURCE_COMMIT: "1111111aaa", GITHUB_SHA: "2222222bbb" };
    expect(commitFromEnv(both).sha).toBe("1111111");
  });

  it("treats an empty or blank value as no answer at all", () => {
    // A platform that exports the variable unset is the common case, and "" is not a commit.
    expect(commitFromEnv({ SOURCE_COMMIT: "" })).toEqual({ sha: "", from: "none" });
    expect(commitFromEnv({ SOURCE_COMMIT: "   " })).toEqual({ sha: "", from: "none" });
  });

  it("answers none when the environment names no commit", () => {
    expect(commitFromEnv({})).toEqual({ sha: "", from: "none" });
  });

  it("reads the same names the build script stamps from", () => {
    // The two are read at different moments and must agree about what a commit is called.
    expect([...COMMIT_VARS]).toEqual([
      "SOURCE_COMMIT",
      "GIT_SHA",
      "GIT_COMMIT_SHA",
      "COMMIT_SHA",
      "GITHUB_SHA",
    ]);
  });
});
