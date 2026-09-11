import type { Metadata } from "next";
import Link from "next/link";
import { createApi } from "@/lib/api";
import { loadWebConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Where each step runs",
  description: "Which part of Ketsuban sees what, read back from the deployment itself.",
};

/**
 * What this deployment can and cannot see, from its own answers.
 *
 * Every other page asks a reader to trust the names rather than the service. This one is about the one
 * step the chain cannot show them: somewhere a Privy identity token is read and a record is signed as
 * registrar, and who is holding that token at the time is the whole security story. The page reads the
 * deployment to say which of the two it is doing, because a claim about an enclave is worth nothing
 * from a page that would make it either way.
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
  /*
   * Three states, not two. A deployment that cannot be read right now is not a deployment whose keys
   * disagree, and saying so puts a false alarm about the sharpest failure there is in front of the
   * reader who came here to check exactly that.
   */
  const readable = !!enclave && !!trusted;
  const keyMatches = readable && enclave.address.toLowerCase() === trusted.toLowerCase();

  return (
    <>
      <section className="hero">
        <h1>Where each step runs</h1>
        <p>
          A record here is signed by a key the chain already trusts, from an identity token that lists every
          account you have ever linked. Who holds that token while it is read is the only part of this a name
          cannot show you, so this page says it plainly.
        </p>
      </section>

      <section className="card">
        <h2>Today, on this deployment</h2>
        {config.confidential ? (
          <p data-testid="stance">
            The attester runs as a <strong>Chainlink CRE workflow</strong>, and the step that reads your
            identity token is a <code>handlerInTee</code> — it executes inside an AWS Nitro enclave on
            hardware neither this service nor its operator controls. The token is read there and nowhere else.
            What leaves is one signed record for the one account you chose.
          </p>
        ) : (
          <p data-testid="stance">
            The attester signs on <strong>this deployment&apos;s own node</strong>. The operator&apos;s
            service reads your identity token and holds the registrar key. The same handler is written to run
            inside a Chainlink CRE enclave — <code>packages/cre/attest</code>, and it is exercised in the TEE
            simulator on every change — but this deployment has not been enrolled to run it, so that guarantee
            is not being claimed here.
          </p>
        )}
      </section>

      {/* Evidence, not a promise. The workflow is not enrolled here, but the path it writes through has
          carried a record onto this very chain, and both ends of that are things a reader can check. */}
      <section className="card">
        <h2>The path has carried a record, on this chain</h2>
        <p>
          The enclave handler verified an identity token and a wallet intent, signed the record as registrar
          and wrote it through the DON. What landed is a name that resolves like any other:
        </p>
        <table data-testid="proven-run">
          <tbody>
            <tr>
              <td>Transaction</td>
              <td>
                <a
                  href="https://sepolia.etherscan.io/tx/0x71b7edd59b72677a5bed8c12ca719b2de3b3f5dcd23c62b9e14be52bc8e211e0"
                  rel="noreferrer"
                >
                  <code>0x71b7edd5…e211e0</code>
                </a>
              </td>
            </tr>
            <tr>
              <td>The name it registered</td>
              <td>
                <Link href="/v/alice.com.x.www.ketsuban.eth">
                  <code>alice.com.x.www.ketsuban.eth</code>
                </Link>
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted">
          Said exactly: the nodes were simulated and the forwarder was Chainlink&apos;s
          <code> MockKeystoneForwarder</code>, which is what a workflow without deployment access writes
          through. The handler, the registrar signature, the reporter, the bridge, the Multipass record and
          the transaction were all real. What a live deployment changes is who runs the nodes, not what the
          record is.
        </p>
      </section>

      <section className="card">
        <h2>The key the chain trusts</h2>
        <p className="muted">
          Multipass checks the registrar&apos;s signature on a record, never who submitted it. So the question
          is only ever which key signed — and the deployment answers that itself.
        </p>
        <table data-testid="keys">
          <tbody>
            <tr>
              <td>Registrar every domain is initialised with</td>
              <td>
                <code>{trusted ?? "—"}</code>
              </td>
            </tr>
            <tr>
              <td>Key the attester says it signs as</td>
              <td>
                <code>{signsAs ?? "—"}</code>
              </td>
            </tr>
            <tr>
              <td>Key a view code is encrypted to</td>
              <td>
                <code>{enclave?.address ?? "—"}</code>
              </td>
            </tr>
          </tbody>
        </table>
        <p className={keyMatches || !readable ? "muted" : "warning"} data-testid="key-verdict">
          {!readable
            ? "This deployment did not answer just now, so these could not be compared. Read them yourself with GET /v1/preflight."
            : keyMatches
              ? "The same key in all three, which is what makes a record this service signs acceptable on chain — and what makes a view code openable only where that key is."
              : "These do not agree, so records this service signs would be refused at registration. Read them yourself with GET /v1/preflight."}
        </p>
      </section>

      <section className="card">
        <h2>What is never in the enclave, on purpose</h2>
        <ul>
          <li>
            <strong>Your World ID proof.</strong> Verified by the relay against World, because it carries no
            secret of yours and World is the party that decides whether the mathematics holds.
          </li>
          <li>
            <strong>Reference letters.</strong> Kept by this service so a reader can be handed a copy; only
            the <code>sha256:…</code> that names one is permanent, and a copy that does not hash to it is
            refused rather than shown.
          </li>
          <li>
            <strong>Who may read a masked account.</strong> The permission is signed by the candidate and
            addressed to one reader; this service stores it but cannot open it, because the view code inside
            is encrypted to the registrar key.
          </li>
        </ul>
      </section>

      <section className="card">
        <h2>Check it rather than believe it</h2>
        <ul>
          <li>
            <code>GET /v1/preflight</code> — the registrar the chain expects, and every warning this
            deployment has about itself.
          </li>
          <li>
            <code>GET /v1/enclave-key</code> — the key a view code is encrypted to.
          </li>
          <li>
            Every name on every page resolves through ENS with no part of this service in the path.{" "}
            <Link href="/names">What every name means →</Link>
          </li>
        </ul>
        {preflight && preflight.warnings.length > 0 && (
          <div data-testid="self-reported">
            <h3>What this deployment says is wrong with it</h3>
            <ul>
              {preflight.warnings.map((w) => (
                <li key={w} className="muted">
                  {w}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </>
  );
}
