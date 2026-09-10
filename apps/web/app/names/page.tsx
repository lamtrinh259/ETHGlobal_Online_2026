import type { Metadata } from "next";
import Link from "next/link";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { nameKinds } from "@/lib/namespace";
import { Explain } from "./Explain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Names",
  description: "What every name in this deployment means, read back from the chain.",
};

/** Every name this deployment answers for, and what each one claims. Read from the mounts, not a list. */
export default async function NamesPage() {
  const config = loadWebConfig();
  const api = createApi(config.apiUrl, config.attestUrl);
  const contracts = await api.contracts().catch(() => undefined);
  const kinds = nameKinds(contracts, config.nameDomains);
  const mounts = (contracts?.instances ?? []).filter((i) => !config.nameDomains.includes(i.domain));

  return (
    <>
      <h1>Names</h1>
      <p className="muted">
        A name here is a claim you can check yourself, in any ENS client, without asking this service. Each
        one below is built from a mount recorded on chain.
      </p>

      {kinds.length === 0 ? (
        <p className="error" role="alert">
          This deployment has no mounts to describe.
        </p>
      ) : (
        <ul className="cards" data-testid="name-kinds">
          {kinds.map((k) => (
            <li className="card" key={k.pattern}>
              <h3>{k.what}</h3>
              <code>{k.pattern}</code>
              <p className="muted">{k.detail}</p>
            </li>
          ))}
        </ul>
      )}

      {contracts && <Explain contracts={contracts} nameDomains={config.nameDomains} />}

      {mounts.length > 0 && (
        <section className="card">
          <h2>What is mounted</h2>
          <p className="muted">
            A platform or mail host nobody has deployed yet is mounted while the first account there is
            attested, so this list grows on its own.
          </p>
          <table data-testid="mounts">
            <thead>
              <tr>
                <th>domain</th>
                <th>in the open</th>
                <th>kept private</th>
              </tr>
            </thead>
            <tbody>
              {mounts.map((i) => (
                <tr key={i.domain}>
                  <td>
                    <code>{i.domain}</code>
                  </td>
                  <td>
                    <code>{i.parentName}</code>
                  </td>
                  <td>
                    {i.maskedParentName ? (
                      <code>{i.maskedParentName}</code>
                    ) : (
                      <small className="muted">—</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p>
        <Link href="/verify">Check a name →</Link>
      </p>
    </>
  );
}
