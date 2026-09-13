import type { Metadata } from "next";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";
import { short } from "@/app/ui";
import { chainName, ensAppName, explorerAddress } from "@/lib/explorer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Who can see what",
  description:
    "How a vouch is made, where the secret part runs, and what this deployment admits about itself.",
};

/** One step of writing a record: where it happens, and what it can see while it does. */
const STEPS = [
  { at: "your browser", does: "you sign what you want written", sees: "everything you typed", inside: false },
  { at: "the enclave", does: "checks your login token", sees: "every account you linked", inside: true },
  {
    at: "the enclave",
    does: "writes and signs one record",
    sees: "only the account you chose",
    inside: true,
  },
  { at: "the DON", does: "carries the signed record", sees: "the record, nothing else", inside: false },
  { at: "the chain", does: "Multipass keeps it", sees: "the record, nothing else", inside: false },
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
 * Who can see what, said so a first-time reader gets it.
 *
 * Every other page asks a reader to trust names rather than this service. This one explains the
 * three parts and the one step the chain cannot show them, and it is read from the deployment rather
 * than asserted: a claim about a sealed box is worth nothing from a page that would make it either way.
 */
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export default async function TrustPage() {
  const config = loadWebConfig();
  const api = createApi(config.apiUrl, config.attestUrl);
  const [enclave, preflight, contracts] = await Promise.all([
    api.enclaveKey().catch(() => null),
    api.preflight().catch(() => null),
    api.contracts().catch(() => null),
  ]);

  const signsAs = preflight?.registrar?.signsAs ?? null;
  const onchain = [...new Set(preflight?.multipass?.domains?.map((d) => d.registrar) ?? [])];
  const trusted = onchain.length === 1 ? onchain[0] : null;
  const readable = !!enclave && !!trusted;
  const keyMatches = readable && enclave.address.toLowerCase() === trusted.toLowerCase();

  return (
    <>
      <section className="hero">
        <h1>Who can see what</h1>
        <p>A vouch is a signed note on a public register. Here is who touches it, and what each one sees.</p>
      </section>

      <section className="card trust">
        <h2>The three parts</h2>
        <Chain
          steps={[
            {
              at: "Multipass",
              does: "the register, on chain",
              sees: "one record per name per domain; nobody can edit it in place",
            },
            {
              at: "the registrar",
              does: "the one key Multipass trusts",
              sees: "a record counts only if this key signed it",
            },
            {
              at: "the name",
              does: "what you hand people",
              sees: "alice.ketsuban.eth reads the record back, in any ENS client",
            },
          ]}
        />
        <p className="muted">
          You never write to the register yourself. You ask; the registrar checks; the registrar signs; the
          chain keeps the signed record. The registrar is the whole game, so where it runs is the question.
        </p>
      </section>

      <section className="card trust">
        <h2>Why the registrar sits in a sealed box</h2>
        <p>
          To prove an account is yours, the registrar must read your login token. That token lists{" "}
          <em>every</em> account you ever linked, not only the one you chose to show. Whoever holds the
          registrar could read all of it.
        </p>
        <p>
          So the registrar runs inside a sealed box — a Chainlink CRE enclave, a TEE. The box reads the token,
          writes one record naming only the account you chose, signs it, and forgets the rest. Not even the
          people running this site can look inside. A masked account&apos;s view code is sealed to the same
          box, so nobody else can open it either.
        </p>
        <Chain steps={STEPS} testid="flow" />
        <p className={config.confidential ? "muted" : "warning"} data-testid="stance">
          {config.confidential
            ? "Here, the green steps run inside an AWS Nitro enclave that neither this site nor its operator controls."
            : "Here, honestly: the green steps are written for the box and tested in its simulator, but this deployment has not been enrolled, so the registrar runs on this site's own server and its operator could read them. Not claimed here until it is."}
        </p>
      </section>

      <section className="card trust">
        <h2>One key, three places it must match</h2>
        <p className="muted">
          The chain expects a registrar key. The site signs with a key. View codes are sealed to a key. Same
          key in all three, or nothing works — and nothing can be faked.
        </p>
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

      <section className="card trust" data-testid="contracts">
        <h2>Nothing here is mocked: the contracts, on {chainName(config.chainId)}</h2>
        <p className="muted">
          Every address this deployment writes to or reads from, on the public explorer. Open any of them and
          read the same records this site shows.
        </p>
        <table data-testid="contract-links">
          <tbody>
            {(
              [
                ["Multipass, the register", config.multipass],
                ["the registrar key", trusted],
                ["the attestation bridge", contracts?.bridge ?? null],
                ["the permissioned resolver", contracts?.permissionedResolver ?? null],
                ["the root resolver, answering every name from Multipass", contracts?.rootResolver ?? null],
                ["the .eth registry", contracts?.ethRegistry ?? null],
                // A level served by the root resolver has no registry and nothing of its own to list.
                ...(contracts?.instances ?? []).flatMap((i) => [
                  [`${i.parentName} registry`, i.registry] as const,
                  [
                    `${i.parentName} resolver`,
                    i.resolver === contracts?.rootResolver ? null : i.resolver,
                  ] as const,
                ]),
              ] as const
            )
              .filter(([, a]) => !!a && a !== ZERO_ADDRESS)
              .map(([what, address]) => {
                const href = explorerAddress(config.chainId, address as string);
                return (
                  <tr key={what}>
                    <td>{what}</td>
                    <td>
                      {href ? (
                        <a href={href} rel="noreferrer">
                          <code>{address}</code>
                        </a>
                      ) : (
                        <code>{address}</code>
                      )}
                    </td>
                  </tr>
                );
              })}
            {/* The root name only: a subject under it is a wildcard name with no page of its own there. */}
            {config.instances.slice(0, 1).map((i) => {
              const href = ensAppName(config.chainId, i.parentName);
              return (
                <tr key={i.parentName}>
                  <td>the name, in the ENS app</td>
                  <td>
                    {href ? (
                      <a href={href} rel="noreferrer">
                        <code>{i.parentName}</code>
                      </a>
                    ) : (
                      <code>{i.parentName}</code>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card trust">
        <h2>It has done it for real</h2>
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
          The private one stores no handle at all: scrambled bytes and a lock only a view code opens. Nodes
          simulated, forwarder Chainlink&apos;s MockKeystoneForwarder; handler, signature, bridge and record
          real.
        </p>
      </section>

      <section className="card trust" data-testid="how-rank">
        <h2>How SybilScore is counted</h2>
        <p className="muted">
          Fake accounts can vouch for each other all day. What they cannot do is be a real person.
        </p>
        <Chain
          steps={[
            {
              at: "edges",
              does: "every live vouch is a line, writer → subject",
              sees: "signed records, nothing guessed",
            },
            {
              at: "seeds",
              does: "people who passed a Selfie Check",
              sees: "the one thing you cannot hold twice",
            },
            {
              at: "walk",
              does: "trust flows from seeds along the lines",
              sees: "teams fill up; rings of fakes barely do",
            },
            {
              at: "rank",
              does: "trust divided by connections",
              sees: "collecting connections earns nothing",
            },
            {
              at: "SybilScore",
              does: "0–100: a real person is 20, each vouch adds up to 15 of its writer's score",
              sees: "a newcomer starts at 0; a ring nobody proved stays at 0",
            },
          ]}
        />
        <p className="muted">A signal beside the count and the shape, never a verdict.</p>
      </section>

      <section className="card trust" data-testid="how-read">
        <h2>How a vouch is read</h2>
        <Chain
          steps={[
            { at: "the words", does: "31 bytes somebody signed", sees: "always shown as written" },
            {
              at: "the council",
              does: "three AI models read them, once",
              sees: "the words are data, never instructions",
            },
            {
              at: "polarity",
              does: "critical … supportive, and one sentence why",
              sees: "same words, same reading",
            },
            {
              at: "provisional",
              does: "until real peers have judged",
              sees: "no council configured → shown unread",
            },
          ]}
        />
        <p className="muted">It reads sentences, not people.</p>
      </section>

      <section className="card trust">
        <h2>Outside the box, on purpose</h2>
        <ul className="self-reported">
          <li>
            <strong>Your World ID proof</strong> — has no secret of yours in it; World says whether it holds.
          </li>
          <li>
            <strong>Vouch letters</strong> — kept on this site; only their fingerprint is on chain, forever.
          </li>
          <li>
            <strong>Who may read a masked account</strong> — kept on this site; opens only inside the box.
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
