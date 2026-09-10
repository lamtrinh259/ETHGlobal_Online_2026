/**
 * Where a commit sha can come from.
 *
 * The same names the build script looks for, kept in one place because the build and the running
 * container read them at different moments: the build stamps whatever it was given, and a platform
 * that only sets the variable at run time leaves that stamp empty. Reading both is how a deployment
 * can still say which commit it is.
 */
export const COMMIT_VARS = [
  "SOURCE_COMMIT",
  "GIT_SHA",
  "GIT_COMMIT_SHA",
  "COMMIT_SHA",
  "GITHUB_SHA",
] as const;

/** The first commit sha the environment names, short, with which variable carried it. */
export function commitFromEnv(env: Record<string, string | undefined>): { sha: string; from: string } {
  for (const name of COMMIT_VARS) {
    const value = (env[name] ?? "").trim();
    if (value) return { sha: value.slice(0, 7), from: name };
  }
  return { sha: "", from: "none" };
}
