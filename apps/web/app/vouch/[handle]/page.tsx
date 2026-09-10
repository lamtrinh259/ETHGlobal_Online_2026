import type { Metadata } from "next";
import Link from "next/link";
import { decodeInvite, type SignedInvite } from "@ketsuban/registrar";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { HANDLE_RE } from "@/lib/profile";
import { askById } from "@/lib/asks";
import { VouchFlow } from "./VouchFlow";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ invite?: string; withdraw?: string; ask?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  return { title: `Vouch for ${decodeURIComponent(handle)}` };
}

/**
 * Voucher journey (spec §3.3): open link → sign in → prove unique humanity → corroborate work
 * context → write and sign → receive a persistent name. Steps 3 and 5 depend on the World Selfie
 * Check partnership and the per-candidate vouch instance; they are shown honestly as pending.
 */
export default async function VouchPage({ params, searchParams }: Params) {
  const { handle: raw } = await params;
  const { invite: token, withdraw, ask } = await searchParams;
  const handle = decodeURIComponent(raw).toLowerCase();
  const config = loadWebConfig();
  const root = config.instances[0];
  if (!HANDLE_RE.test(handle)) {
    return (
      <section className="card">
        <p className="error" role="alert">
          not a valid handle
        </p>
      </section>
    );
  }
  // A malformed or truncated link is simply no invitation; the flow says what to do about it.
  let invite: SignedInvite | undefined;
  try {
    invite = token ? decodeInvite(token) : undefined;
  } catch {
    invite = undefined;
  }
  const api = createApi(config.apiUrl, config.attestUrl);
  const [status, vouches] = await Promise.all([
    root ? api.nameStatus(root.domain, handle).catch(() => undefined) : undefined,
    api.vouches(handle).catch(() => undefined),
  ]);
  const live = vouches
    ? new Set(vouches.vouches.filter((v) => v.live).map((v) => v.voucher)).size
    : undefined;
  return (
    <>
      <section className="hero">
        <h1>
          Vouch for <span className="knot">{handle}</span>
        </h1>
        {status && (
          <p className={status.live ? "muted" : "error"} data-testid="candidate-status">
            {status.live
              ? `claimed · ${live ?? "?"} live reference${live === 1 ? "" : "s"} so far`
              : status.taken
                ? "this name has expired — ask the candidate to renew before you vouch"
                : "not claimed yet — an organisation can write now and the letter waits for them"}
          </p>
        )}
        <p>
          You are about to put your own permanent name behind{" "}
          <Link href={`/p/${handle}`}>
            {handle}.{root?.parentName}
          </Link>
          . Five minutes. Nothing you sign here can be deleted — only revoked, visibly.
        </p>
      </section>
      <VouchFlow candidate={handle} invite={invite} withdraw={withdraw === "1"} ask={askById(ask)} />
    </>
  );
}
