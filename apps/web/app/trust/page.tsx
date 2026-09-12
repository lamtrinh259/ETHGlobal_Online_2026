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
                  {/* Short while they agree: three identical addresses, each wrapping across two lines
                      of a phone, said the one thing the verdict below them already says. Where they
                      disagree, which of them differs is the whole point, so they are printed in full. */}
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

      <section className="card" data-testid="how-rank">
        <h2>How the reference map is scored</h2>
        <ol className="flow">
          <li>
            <strong>edges</strong>
            <span>every live reference, from whoever wrote it to whoever it is for</span>
            <small className="muted">a signed record anyone can resolve; nothing inferred</small>
          </li>
          <li>
            <strong>seeds</strong>
            <span>whoever holds a live Selfie Check proof</span>
            <small className="muted">the only part of this nobody can hold twice</small>
          </li>
          <li>
            <strong>walk</strong>
            <span>trust spreads from the seeds along references, a few steps, edges taken either way</span>
            <small className="muted">after SybilRank, NSDI 2012: honest regions fill, rings barely do</small>
          </li>
          <li>
            <strong>rank</strong>
            <span>trust per connection, so connections alone earn nothing</span>
            <small className="muted">a signal, shown beside the count and the shape, never a verdict</small>
          </li>
          <li>
            <strong>SybilScore</strong>
            <span>
              what accumulated, 0–100: proved humanity is a floor of 20, every live reference adds up to 15 —
              a share of its writer's score
            </span>
            <small className="muted">
              a newcomer starts at nothing; a ring nobody proved sums to nothing however tightly it is wired
            </small>
          </li>
        </ol>
        <p className="muted">
          A newcomer with one honest reference and a ring with one bought one look alike until more people
          speak. What the map adds is whether the people behind somebody know each other — which is what a
          count cannot say.
        </p>
      </section>

      <section className="card" data-testid="how-read">
        <h2>How statements are read</h2>
        <ol className="flow">
          <li>
            <strong>the words</strong>
            <span>thirty-one bytes somebody signed about somebody else, the record itself</span>
            <small className="muted">
              shown as written, always; the reading is a way in, not a replacement
            </small>
          </li>
          <li>
            <strong>the council</strong>
            <span>
              each statement goes once to Noolog&apos;s fast council: three models on independent families,
              one round
            </span>
            <small className="muted">
              the statement is data to be read, never instructions to follow — the rubric says so
            </small>
          </li>
          <li>
            <strong>polarity</strong>
            <span>−1 critical … +1 supportive, with one sentence of why</span>
            <small className="muted">
              a classification of text, kept by the hash of the words: the same words read the same
            </small>
          </li>
          <li>
            <strong>provisional</strong>
            <span>marked so, until peers in a cohort have judged</span>
            <small className="muted">
              three models agreeing on how a sentence reads is not a community judgement
            </small>
          </li>
        </ol>
        <p className="muted">
          Where no council is configured, statements are shown unread rather than scored by anything else.
          Nothing here rates a person; it reads sentences, says which, and sums them into one line so a reader
          with a minute knows whether to open the fold.
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
