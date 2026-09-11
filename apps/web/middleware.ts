import { NextResponse, type NextRequest } from "next/server";

/**
 * A person's name is that person's page, for every reader.
 *
 * The page itself can redirect, but a redirect from inside a rendered Server Component reaches the
 * client as a 200 carrying an instruction to navigate: a browser follows it, and `curl`, a crawler or
 * an agent gets a shell and stops. This product's whole claim is that a name can be read without its
 * app, so the half that breaks is the half that matters. Answered here instead, before anything is
 * rendered, as a real redirect.
 *
 * One label under a root name is a person. Two is a reference written for one — `bob.alice.<root>` —
 * and an account sits deeper still; neither has a candidate page, so both are left to `/v/`.
 */
const ROOTS = (process.env.NEXT_PUBLIC_PARENT_NAMES ?? "")
  .split(",")
  .map((p) => p.trim().toLowerCase())
  .filter(Boolean);

export function middleware(req: NextRequest) {
  const name = decodeURIComponent(req.nextUrl.pathname.slice("/v/".length)).toLowerCase();
  // The first root is the one people are named under; the rest are subjects, whose own names are not.
  const root = ROOTS[0];
  if (!root || !name.endsWith(`.${root}`)) return NextResponse.next();

  const handle = name.slice(0, -(root.length + 1));
  if (!handle || handle.includes(".")) return NextResponse.next();
  // A subject instance is a page about a question, not about somebody.
  if (ROOTS.slice(1).some((r) => r === name)) return NextResponse.next();

  const to = req.nextUrl.clone();
  to.pathname = `/p/${handle}`;
  return NextResponse.redirect(to, 308);
}

export const config = { matcher: "/v/:name*" };
