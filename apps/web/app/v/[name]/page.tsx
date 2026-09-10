import type { Metadata } from "next";
import { EnsProof } from "@/app/EnsProof";
import { InstanceAnswers } from "@/app/InstanceAnswers";
import { Revealed } from "@/app/Revealed";
import { VerifyCard } from "@/app/VerifyCard";
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
    const [v, ens, claim, instance] = await Promise.all([
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
    ]);
    return (
      <>
        <VerifyCard v={v} />
        {instance && <InstanceAnswers data={instance} />}
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
