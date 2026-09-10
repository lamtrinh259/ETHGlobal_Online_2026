/**
 * Which commit this service is running.
 *
 * A container built from an archive has no git to ask, and platforms name the commit differently, so
 * the answer is read from the environment and the variable that carried it is reported alongside it.
 * Without this, "is my fix deployed?" can only be answered by poking the service and inferring from
 * how it behaves — which is exactly the moment somebody is already unsure what they are looking at.
 */
export const COMMIT_VARS = [
  "SOURCE_COMMIT",
  "GIT_SHA",
  "GIT_COMMIT_SHA",
  "COMMIT_SHA",
  "GITHUB_SHA",
] as const;

export function commitFromEnv(env: NodeJS.ProcessEnv = process.env): { sha: string; from: string } {
  for (const name of COMMIT_VARS) {
    const value = (env[name] ?? "").trim();
    if (value) return { sha: value.slice(0, 7), from: name };
  }
  return { sha: "", from: "none" };
}
