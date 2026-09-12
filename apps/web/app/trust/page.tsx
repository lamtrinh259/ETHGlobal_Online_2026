import type { Metadata } from "next";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { short } from "@/app/ui";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Where each step runs",
  description: "Which part of Ketsuban sees what, read back from the deployment itself.",
};

/** One step of an attestation: where it happens, and what it can see while it does. */
const STEPS = [
  { at: "your browser", does: "signs an intent", sees: "everything you typed", inside: false },
  { at: "the enclave", does: "reads your identity token", sees: "every linked account", inside: true },
  { at: "the enclave", does: "signs as registrar", sees: "the one account you chose", inside: true },
  { at: "the DON", does: "carries the report", sees: "the signed record", inside: false },
  { at: "the chain", does: "registers the name", sees: "the signed record", inside: false },
];

/** A chain of steps, each one an arrow away from the next. */
function Chain({
  steps,
  testid,
}: {
  steps: { at: string; does: string; sees?: string; inside?: boolean }[];
  testid?: string;
}) {
  return (
    <ol className="chain" data-testid={testid}>
      {steps.map((s, i) => (
        <li key={i} className={s.inside ? "chain-step inside" : "chain-step"}>
          <strong>{s.at}</strong>
          <span>{s.does}</span>
          {s.sees && <small className="muted">{s.sees}</small>}
        </li>
      ))}
    </ol>
  );
}

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
        <p>Your identity token lists every account you linked. This is who holds it while it is read.</p>
      </section>

      <section className="card trust">
        <h2>
          {config.confidential ? "Read inside a Chainlink CRE enclave" : "Signed on this deployment's node"}
        </h2>
        <Chain steps={STEPS} testid="flow" />
        <p className="muted" data-testid="stance">
          {config.confidential
            ? "Green steps run in an AWS Nitro enclave that neither this service nor its operator controls."
            : "Green steps are written for an enclave and tested in its simulator. This deployment has not been enrolled, so its operator could read them. Not claimed here until it is."}
        </p>
      </section>

      <section className="card trust">
        <h2>The key the chain trusts</h2>
        <table data-testid="keys">
          <tbody>
            {(
              [
                ["every domain expects", trusted],
                ["the attester signs as", signsAs],
                ["a view code is sealed to", enclave?.address],
              ] as const
            ).map(([role, key]) => (
              <tr key={role}>
                <td>{role}</td>
                <td>
                  {/* Short while they agree; where they disagree, which one differs is the point. */}
                  <code>{!key ? "—" : keyMatches ? short(key) : key}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {keyMatches && trusted && (
          <p data-testid="the-key">
            <code>{trusted}</code>
          </p>
        )}
        <p className={keyMatches || !readable ? "muted" : "warning"} data-testid="key-verdict">
          {!readable
            ? "Not answering just now — GET /v1/preflight."
            : keyMatches
              ? "One key in all three: records are accepted on chain, and a view code opens nowhere else."
              : "These disagree: records signed here would be refused at registration."}
        </p>
      </section>

      <section className="card trust">
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
          The private one stores no handle: a one-time pad and a view-code commitment. Nodes simulated,
          forwarder Chainlink&apos;s MockKeystoneForwarder; handler, signature, bridge and record real.
        </p>
      </section>

      <section className="card trust" data-testid="how-rank">
        <h2>How the reference map is scored</h2>
        <Chain
          steps={[
            {
              at: "edges",
              does: "every live reference, writer → subject",
              sees: "signed records, nothing inferred",
            },
            {
              at: "seeds",
              does: "whoever holds a live Selfie Check",
              sees: "the one thing nobody holds twice",
            },
            {
              at: "walk",
              does: "trust spreads from seeds along references",
              sees: "SybilRank: teams fill, rings barely do",
            },
            { at: "rank", does: "trust per connection", sees: "connections alone earn nothing" },
            {
              at: "SybilScore",
              does: "0–100: humanity 20, each reference up to 15 of its writer's score",
              sees: "a newcomer starts at 0; a ring nobody proved sums to 0",
            },
          ]}
        />
        <p className="muted">A signal beside the count and the shape, never a verdict.</p>
      </section>

      <section className="card trust" data-testid="how-read">
        <h2>How statements are read</h2>
        <Chain
          steps={[
            { at: "the words", does: "31 bytes somebody signed", sees: "always shown as written" },
            {
              at: "the council",
              does: "Noolog fast council: three models, one round",
              sees: "data to read, never instructions",
            },
            {
              at: "polarity",
              does: "−1 critical … +1 supportive, one sentence of why",
              sees: "same words, same reading",
            },
            {
              at: "provisional",
              does: "until peers in a cohort have judged",
              sees: "no council configured → unread",
            },
          ]}
        />
        <p className="muted">It reads sentences, not people.</p>
      </section>

      <section className="card trust">
        <h2>Outside the enclave, deliberately</h2>
        <ul className="self-reported">
          <li>
            <strong>World ID proof</strong> — no secret of yours; World decides.
          </li>
          <li>
            <strong>Reference letters</strong> — kept here; only the hash is permanent.
          </li>
          <li>
            <strong>Who may read a masked account</strong> — kept here; opens only where the registrar key is.
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
