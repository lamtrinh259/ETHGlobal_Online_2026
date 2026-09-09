import type { EnsResolution } from "@/lib/api";
import { short } from "./ui";

/**
 * The same name read through the ENSv2 UniversalResolver. It proves the page is not the source of
 * truth: any wallet or indexer walking the registry reaches the same resolver and the same values.
 */
export function EnsProof({ ens, name }: { ens: EnsResolution | null; name: string }) {
  return (
    <section className="card" data-testid="ens-proof">
      <h3>Read it yourself, through ENS</h3>
      {ens ? (
        <>
          <p className="muted">
            The UniversalResolver at <code>{short(ens.universalResolver)}</code> walked the registry to{" "}
            <code>{short(ens.resolver)}</code> and returned{" "}
            {ens.addr ? <code>{short(ens.addr)}</code> : <em>no address</em>}
            {ens.status === "inactive" && " — nothing is registered here right now"}.
          </p>
          {Object.entries(ens.texts).filter(([, v]) => v).length > 0 && (
            <dl className="kv">
              {Object.entries(ens.texts)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="kv-row">
                    <dt>
                      <code>{k}</code>
                    </dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          )}
        </>
      ) : (
        <p className="muted">
          This deployment has no UniversalResolver configured, so there is nothing to cross-check here.
        </p>
      )}
      <pre>
        <code>
          {`cast call ${ens ? ens.universalResolver : "<universal-resolver>"} \\
  "resolve(bytes,bytes)(bytes,address)" \\
  $(cast --to-dns-name ${name}) \\
  $(cast calldata "text(bytes32,string)" $(cast namehash ${name}) "ketsuban:answer")`}
        </code>
      </pre>
    </section>
  );
}
