import type { Metadata } from "next";
import Link from "next/link";
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
  return (
    <>
      <section className="hero">
        <h1>
          Vouch for <span className="knot">{handle}</span>
        </h1>
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
