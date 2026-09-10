import type { Metadata } from "next";
import Link from "next/link";
import { decodeInvite, type SignedInvite } from "@ketsuban/registrar";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { HANDLE_RE } from "@/lib/profile";
import { askById } from "@/lib/asks";
import { ProfileHead } from "@/app/ProfileHead";
import { VouchFlow } from "./VouchFlow";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ invite?: string; withdraw?: string; ask?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { handle } = await params;
  return { title: `Refer ${decodeURIComponent(handle)}` };
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
  // A short code stands for the same signed invitation; it is fetched and then checked identically.
  const fromCode =
    token && /^[0-9a-f]{8}$/.test(token)
      ? await createApi(config.apiUrl, config.attestUrl)
          .invite(token)
          .then((r) => r.invite as unknown as Record<string, string>)
          .catch(() => undefined)
      : undefined;
  try {
    invite = fromCode
      ? ({
          handle: fromCode.handle,
          voucher: fromCode.voucher,
          exp: BigInt(fromCode.exp),
          requires: (fromCode.requires as unknown as string[]) ?? [],
          signature: fromCode.signature,
        } as SignedInvite)
      : token
        ? decodeInvite(token)
        : undefined;
  } catch {
    invite = undefined;
  }
  const api = createApi(config.apiUrl, config.attestUrl);
  const candidateName = root ? `${handle}.${root.parentName}` : handle;
  const [status, vouches, candidate] = await Promise.all([
    root ? api.nameStatus(root.domain, handle).catch(() => undefined) : undefined,
    api.vouches(handle).catch(() => undefined),
    // Who you are about to put your name behind. A handle is not a person, and this page asked for a
    // permanent signature while showing nothing but the handle.
    root ? api.verify(candidateName).catch(() => null) : null,
  ]);
  const live = vouches
    ? new Set(vouches.vouches.filter((v) => v.live).map((v) => v.voucher)).size
    : undefined;
  return (
    <>
      <section className="hero">
        <h1>
          Refer <span className="knot">{handle}</span>
        </h1>
        <ProfileHead
          ensName={candidateName}
          records={{
            description: candidate?.profile?.description ?? undefined,
            url: candidate?.profile?.url ?? undefined,
            avatar: candidate?.profile?.avatar ?? undefined,
          }}
        />
        {status && (
          <p className={status.live ? "muted" : "error"} data-testid="candidate-status">
            {status.live
              ? `claimed · ${live ?? "?"} live reference${live === 1 ? "" : "s"} so far`
              : status.taken
                ? "this name has expired — ask the candidate to renew before you vouch"
                : "not claimed yet — an organisation can write now and the letter waits for them"}
          </p>
        )}
        <p className="muted">
          Your name goes on this permanently. It can be withdrawn, visibly — never deleted.{" "}
          <Link href={`/p/${handle}`}>Their page →</Link>
        </p>
      </section>
      <VouchFlow candidate={handle} invite={invite} withdraw={withdraw === "1"} ask={askById(ask)} />
    </>
  );
}
