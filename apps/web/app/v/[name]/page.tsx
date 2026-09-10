import type { Metadata } from "next";
import Link from "next/link";
import { EnsProof } from "@/app/EnsProof";
import { InstanceAnswers } from "@/app/InstanceAnswers";
import { Revealed } from "@/app/Revealed";
import { VerifyCard } from "@/app/VerifyCard";
import { SybilScore } from "@/app/SybilScore";
import { VouchList } from "@/app/VouchList";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ viewCode?: string; links?: string; reveal?: string; for?: string }>;
};

// Server component so a shared link unfurls with the name and its state (crawlers run no JS).
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { name } = await params;
  return {
    title: decodeURIComponent(name),
    description: "Ketsuban verification — read through the ENS resolver.",
  };
}

export default async function VerifyPage({ params, searchParams }: Params) {
  const { name } = await params;
  const { viewCode, links, reveal, for: addressedTo } = await searchParams;
  const config = loadWebConfig();
  const api = createApi(config.apiUrl, config.attestUrl);
  const decoded = decodeURIComponent(name);
  try {
    // A name that is an instance's own is where answers are published, not an unclaimed person.
    const instanceOf = config.instances.find((i) => i.parentName.toLowerCase() === decoded.toLowerCase());
    // A person's own name under the root instance: the label is their handle, which is what the
    // references written about them are filed under.
    const root = config.instances[0];
    const suffix = root ? `.${root.parentName.toLowerCase()}` : null;
    const handle =
      suffix && decoded.toLowerCase().endsWith(suffix) && !instanceOf
        ? decoded.slice(0, -suffix.length).toLowerCase()
        : null;
    const [v, ens, claim, instance, received, sybil] = await Promise.all([
      api.verify(decoded, {
        links: links?.split(","),
        viewCode: viewCode as `0x${string}` | undefined,
      }),
      // The cross-check is a bonus: an unconfigured or unreachable resolver must not break the page.
      api.ens(decoded).catch(() => null),
      // What the name would claim if it resolved: a reader seeing "no record" deserves to know whether
      // nobody holds it or whether it could never have meant anything here.
      api.explain(decoded).catch(() => null),
      instanceOf ? api.instance(instanceOf.domain).catch(() => null) : Promise.resolve(null),
      // What others have said about this person. The page showed only what they said themselves,
      // which is the half a verifier came here least for.
      handle && /^[a-z0-9-]{1,30}$/.test(handle) ? api.vouches(handle).catch(() => null) : null,
      // What the account cost to build. A verifier weighing the references above is owed it, and it is
      // the one number here that cannot be raised by writing more of them.
      handle && /^[a-z0-9-]{1,30}$/.test(handle) ? api.sybil(handle).catch(() => null) : null,
    ]);
    return (
      <>
        {/* An instance name is a page about a subject, not a person's record: leading with "no record"
            described the wrong thing. What it is comes first, and the answers under it follow. */}
        {instance ? <InstanceAnswers data={instance} texts={ens?.texts} /> : <VerifyCard v={v} />}
        {sybil && <SybilScore s={sybil} />}
        {received && handle && (
          <section className="card" aria-label="references received">
            <VouchList vouches={received.vouches} handle={handle} />
            <p className="row">
              <Link className="button primary" href={`/vouch/${handle}`}>
                Refer this person
              </Link>
              <Link className="muted" href={`/p/${handle}`}>
                their full reference page
              </Link>
            </p>
          </section>
        )}
        {v.status === "inactive" && !instance && claim && (
          <section className="card" data-testid="would-claim">
            <h3>What this name would say</h3>
            <p className="muted">{claim.says}</p>
            {claim.kind !== "unknown" && (
              <p className="muted">Nobody holds it yet, so it answers with nothing.</p>
            )}
          </section>
        )}
        {/* One link can open several accounts: the grant was one signature over the whole selection. */}
        {reveal
          ?.split(",")
          .filter(Boolean)
          .map((domain) => (
            <Revealed key={domain} name={decoded} domain={domain} audience={addressedTo} />
          ))}
        <EnsProof ens={ens} name={decoded} />
      </>
    );
  } catch (e) {
    return (
      <section className="card">
        <h2>{decodeURIComponent(name)}</h2>
        <p className="error" role="alert">
          {(e as Error).message}
        </p>
      </section>
    );
  }
}
