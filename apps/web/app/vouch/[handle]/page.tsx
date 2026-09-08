import type { Metadata } from "next";
import Link from "next/link";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { HANDLE_RE } from "@/lib/profile";
import { VouchFlow } from "./VouchFlow";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  return { title: `Vouch for ${decodeURIComponent(handle)}` };
}

/**
 * Voucher journey (spec §3.3): open link → sign in → prove unique humanity → corroborate work
 * context → write and sign → receive a persistent name. Steps 3 and 5 depend on the World Selfie
 * Check partnership and the per-candidate vouch instance; they are shown honestly as pending.
 */
export default async function VouchPage({ params }: Params) {
  const { handle: raw } = await params;
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
                : "not claimed yet — the candidate must claim their name before references can attach"}
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
      <VouchFlow candidate={handle} />
    </>
  );
}
