import type { Metadata } from "next";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Where each step runs",
  description: "Which part of Ketsuban sees what, read back from the deployment itself.",
};

/** One step of an attestation: where it happens, and what it can see while it does. */
const STEPS = [
  { at: "your browser", does: "signs an intent", sees: "everything you typed", inside: false },
  { at: "the enclave", does: "reads your identity token", sees: "every account you linked", inside: true },
  {
    at: "the enclave",
    does: "signs the record as registrar",
    sees: "the one account you chose",
    inside: true,
  },
  { at: "the DON", does: "carries the report", sees: "the signed record", inside: false },
  { at: "the chain", does: "registers the name", sees: "the signed record", inside: false },
];

/**
 * What this deployment can and cannot see.
 *
 * Every other page asks a reader to trust names rather than this service. This one is about the step
 * the chain cannot show them, and it is read from the deployment rather than asserted: a claim about
 * an enclave is worth nothing from a page that would make it either way.
 */
export default async function TrustPage() {
  const config = loadWebConfig();
  const api = createApi(config.apiUrl, config.attestUrl);
  const [enclave, preflight] = await Promise.all([
    api.enclaveKey().catch(() => null),
    api.preflight().catch(() => null),
  ]);

  const signsAs = preflight?.registrar?.signsAs ?? null;
  const onchain = [...new Set(preflight?.multipass?.domains?.map((d) => d.registrar) ?? [])];
  const trusted = onchain.length === 1 ? onchain[0] : null;
  const readable = !!enclave && !!trusted;
  const keyMatches = readable && enclave.address.toLowerCase() === trusted.toLowerCase();

  return (
    <>
      <section className="hero">
        <h1>Where each step runs</h1>
        <p>
          Your identity token lists every account you have linked. Who holds it while it is read is the one
          thing a name cannot show you.
        </p>
      </section>

      <section className="card">
        <h2>
          {config.confidential
            ? "Read inside a Chainlink CRE enclave"
            : "Signed on this deployment's own node"}
        </h2>
        <ol className="flow" data-testid="flow">
          {STEPS.map((s, i) => (
            <li key={i} className={s.inside ? "inside" : undefined}>
              <strong>{s.at}</strong>
              <span>{s.does}</span>
              <small className="muted">sees: {s.sees}</small>
            </li>
          ))}
        </ol>
        <p className="muted" data-testid="stance">
          {config.confidential ? (
            <>
              The boxed steps run inside an AWS Nitro enclave, on hardware neither this service nor its
              operator controls.
            </>
          ) : (
            <>
              The boxed steps are written for an enclave — <code>packages/cre/attest</code>, exercised in the
              TEE simulator on every change — but this deployment has not been enrolled, so its operator could
              read them. Not claimed here until it is.
            </>
          )}
        </p>
      </section>

      <section className="card">
        <h2>The key the chain trusts</h2>
        <table data-testid="keys">
          <tbody>
            <tr>
              <td>every domain expects</td>
              <td>
                <code>{trusted ?? "—"}</code>
              </td>
            </tr>
            <tr>
              <td>the attester signs as</td>
              <td>
                <code>{signsAs ?? "—"}</code>
              </td>
            </tr>
            <tr>
              <td>a view code is sealed to</td>
              <td>
                <code>{enclave?.address ?? "—"}</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p className={keyMatches || !readable ? "muted" : "warning"} data-testid="key-verdict">
          {!readable
            ? "Not answering just now — read them yourself with GET /v1/preflight."
            : keyMatches
              ? "One key in all three. That is what makes a record acceptable on chain, and a view code openable nowhere else."
              : "These disagree, so records signed here would be refused at registration."}
        </p>
      </section>

      <section className="card">
        <h2>It has written a record</h2>
        <table data-testid="proven-run">
          <tbody>
            <tr>
              <td>a public account</td>
              <td>
                <a
                  href="https://sepolia.etherscan.io/tx/0x71b7edd59b72677a5bed8c12ca719b2de3b3f5dcd23c62b9e14be52bc8e211e0"
                  rel="noreferrer"
                >
                  <code>0x71b7edd5…</code>
                </a>
              </td>
            </tr>
            <tr>
              <td>one kept private</td>
              <td>
                <a
                  href="https://sepolia.etherscan.io/tx/0x6af38a23c9dfc94533c1a5fc753a9a0e8608169696e01ccaca8155ed9ae71484"
                  rel="noreferrer"
                >
                  <code>0x6af38a23…</code>
                </a>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          The second stored no handle at all: a one-time pad, and a commitment to a view code. Said exactly —
          the nodes were simulated and the forwarder was Chainlink&apos;s MockKeystoneForwarder; the handler,
          the signature, the reporter, the bridge and the record were real.
        </p>
      </section>

      <section className="card">
        <h2>Outside the enclave, deliberately</h2>
        <ul className="self-reported">
          <li>
            <strong>Your World ID proof</strong> — carries no secret of yours, and World decides whether it
            holds.
          </li>
          <li>
            <strong>Reference letters</strong> — kept here so a reader can be handed one; only the hash is
            permanent.
          </li>
          <li>
            <strong>Who may read a masked account</strong> — stored here, openable only where the registrar
            key is.
          </li>
        </ul>
        {preflight && preflight.warnings.length > 0 && (
          <>
            <h3>What this deployment says is wrong with it</h3>
            <ul className="self-reported" data-testid="self-reported">
              {preflight.warnings.map((w) => (
                <li key={w} className="muted">
                  {w}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
