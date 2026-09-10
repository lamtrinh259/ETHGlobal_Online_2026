import build from "@/lib/build-info.json";

// Readiness probe for the container HEALTHCHECK and Coolify's zero-downtime swap.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    build: build.sha || build.builtAt,
    // Both halves separately, so a probe can tell "which commit" from "when was it built". Read from
    // the file the build stamped, so this and the page can never name different builds.
    sha: build.sha,
    // Where the commit came from, so an empty sha says whether the platform passed one under a name
    // this build does not read, or passed none at all.
    shaFrom: build.shaFrom ?? "unknown",
    builtAt: build.builtAt,
  });
}
