// Readiness probe for the container HEALTHCHECK and Coolify's zero-downtime swap.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ok: true,
    build: process.env.NEXT_PUBLIC_BUILD ?? "",
    // Both halves separately, so a probe can tell "which commit" from "when was it built".
    sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? "",
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME ?? "",
  });
}
