import type { Metadata } from "next";
import Link from "next/link";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { flourish } from "@/lib/patience";
import { ADDRESS_RE } from "@/lib/profile";
import { claimProgress } from "@/lib/journey";
import { fmtUtc, short } from "@/app/ui";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ address: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address } = await params;
  return { title: `${short(decodeURIComponent(address))} — what this wallet holds` };
}

/**
 * The other way a verifier arrives: with an address from a transaction, a signature or a CV rather
 * than a handle. Everything here is the wallet's own records, read from the chain.
 */
export default async function WalletPage({ params }: Params) {
  const address = decodeURIComponent((await params).address);
  if (!ADDRESS_RE.test(address)) {
    return (
      <section className="card">
        <h2>{address}</h2>
        <p className="error" role="alert">
          not a wallet address
        </p>
      </section>
    );
  }
  const config = loadWebConfig();
  const api = createApi(config.apiUrl, config.attestUrl);
  let read: Awaited<ReturnType<typeof api.wallet>> | undefined;
  let error: string | undefined;
  try {
    read = await api.wallet(address);
  } catch (e) {
    error = (e as Error).message;
  }
  // What ENS itself answers for this address, which its holder sets and nothing here can.
  const ens = await api.reverse(address, { signal: flourish() }).catch(() => undefined);

  const names = read?.names ?? [];
  const live = names.filter((n) => n.live);
  /*
   * Who this is, which is the question an address was pasted to ask.
   *
   * The page opened with the shortened address and a note about ENS primary names, and the person's
   * own page was a second link on a row of a list below that. A wallet holding a live name under the
   * root name domain is somebody; say so before saying anything about the wallet.
   */
  const { handle } = claimProgress(read, config.instances);

  return (
    <>
      <section className="hero">
        <h1>
          {handle ? (
            <>
              Wallet of <span className="knot">{handle}</span>
            </>
          ) : (
            <>
              Wallet <span className="knot">{short(address)}</span>
            </>
          )}
        </h1>
        {handle && (
          <p data-testid="wallet-is">
            <Link className="button primary" href={`/p/${handle}`}>
              Open {handle}&apos;s page →
            </Link>
          </p>
        )}
        <p>
          <code>{address}</code>
        </p>
        {ens && (
          <p className="muted" data-testid="wallet-primary">
            {ens.primary ? (
              <>
                ENS answers <code>{ens.primary}</code> for this address, because its holder set that as their
                primary name.
              </>
            ) : (
              <>
                ENS answers nothing for this address: its holder has set no primary name. The names below come
                from the records themselves.
              </>
            )}
          </p>
        )}
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="card" data-testid="wallet-names">
        <h2>Names</h2>
        {live.length === 0 ? (
          <p>
            <em>This wallet holds no live name.</em> An address alone says nothing: a name is what carries
            answers and references.
          </p>
        ) : (
          <ul className="acct">
            {live.map((n) => (
              <li key={`${n.domain}:${n.name}`}>
                <span className="acct-who">
                  <Link href={`/v/${n.ensName}`}>{n.ensName}</Link>
                </span>
                {n.payload && <small className="muted">“{n.payload}”</small>}
                <span className="acct-state">
                  until {fmtUtc(n.validUntil)} · <Link href={`/p/${n.name}`}>reference page</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" data-testid="wallet-accounts">
        <h2>Attested accounts</h2>
        {read?.links.filter((l) => l.live).length ? (
          <ul className="acct">
            {read.links
              .filter((l) => l.live)
              .map((l) => (
                <li key={`${l.domain}:${l.name}`}>
                  <span className="acct-who">{l.domain}</span>
                  <span className="acct-state">
                    {l.optedIn ? "masked — needs a view code to read" : `public: ${l.name}`}
                    {/* The name it answers at, so a reader can check it without this page. */}
                    {l.ensName && (
                      <>
                        {" · "}
                        <Link href={`/v/${l.ensName}`}>
                          <code>{l.ensName}</code>
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              ))}
          </ul>
        ) : (
          <p>
            <em>none</em>
          </p>
        )}
      </section>

      <section className="card" data-testid="wallet-given">
        <h2>References this wallet wrote</h2>
        {read?.given.length ? (
          <ul className="vouches">
            {read.given.map((g) => (
              <li key={`${g.domain}:${g.nonce}`} className={g.live ? "live" : "expired"}>
                <span className="vouch-who">
                  for <Link href={`/p/${g.candidate}`}>{g.candidate}</Link>
                </span>
                <span className="vouch-what">“{g.payload}”</span>
                <span className="vouch-meta muted">
                  {g.live ? "live" : "expired"} · until {fmtUtc(g.validUntil)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            <em>none</em> — this wallet has not vouched for anyone.
          </p>
        )}
      </section>
    </>
  );
}
