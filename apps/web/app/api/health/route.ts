import build from "@/lib/build-info.json";
import { commitFromEnv } from "@/lib/commit";

// Readiness probe for the container HEALTHCHECK and Coolify's zero-downtime swap.
export const dynamic = "force-dynamic";

export function GET() {
  /*
   * The build stamp is inlined at `next build`, so a platform that names the commit only at run time
   * leaves it empty — and then nothing can say which commit is serving. This route runs on the server
   * on every request, so it can also ask the environment now. The baked value still wins where there
   * is one: it is what the page in the footer shows, and the two must not name different builds.
   */
  const runtime = commitFromEnv(process.env);
  return Response.json({
    ok: true,
    build: build.sha || runtime.sha || build.builtAt,
    // Both halves separately, so a probe can tell "which commit" from "when was it built".
    sha: build.sha || runtime.sha,
    // Where the commit came from, so an empty sha says whether the platform passed one under a name
    // this build does not read, passed it only at run time, or passed none at all.
    shaFrom: build.sha
      ? (build.shaFrom ?? "unknown")
      : runtime.from === "none"
        ? "none"
        : `runtime:${runtime.from}`,
    builtAt: build.builtAt,
  });
}
