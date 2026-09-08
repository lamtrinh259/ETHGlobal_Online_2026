// Readiness probe for the container HEALTHCHECK and Coolify's zero-downtime swap.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, build: process.env.NEXT_PUBLIC_BUILD ?? "" });
}
