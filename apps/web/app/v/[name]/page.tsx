import type { Metadata } from "next";
import { EnsProof } from "@/app/EnsProof";
import { VerifyCard } from "@/app/VerifyCard";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ viewCode?: string; links?: string; reveal?: string }>;
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
  const { viewCode, links, reveal } = await searchParams;
  const config = loadWebConfig();
  const api = createApi(config.apiUrl, config.attestUrl);
  const decoded = decodeURIComponent(name);
  try {
    const [v, ens, revealed] = await Promise.all([
      api.verify(decoded, {
        links: links?.split(","),
        viewCode: viewCode as `0x${string}` | undefined,
      }),
      // The cross-check is a bonus: an unconfigured or unreachable resolver must not break the page.
      api.ens(decoded).catch(() => null),
      // An opened account is a permission the candidate signed; a missing or expired one is not an error
      // on this page, it simply stays masked.
      reveal ? api.disclosed(decoded, reveal).catch(() => null) : null,
    ]);
    return (
      <>
        <VerifyCard v={v} />
        {reveal && (
          <section className="card" data-testid="revealed">
            <h3>Opened by the candidate</h3>
            {revealed ? (
              <p>
                Their <code>{revealed.domain}</code> account is <strong>@{revealed.disclosed.handle}</strong>{" "}
                <small className="muted">(platform id {revealed.disclosed.platformId})</small>. You were given
                permission to read this; it was never published.
              </p>
            ) : (
              <p className="muted">
                No live permission to read <code>{reveal}</code> for this name. Ask the candidate for a link,
                or for one addressed to your wallet.
              </p>
            )}
          </section>
        )}
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
