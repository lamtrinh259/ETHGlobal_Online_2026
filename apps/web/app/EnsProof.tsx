import { toHex } from "viem";
import { packetToBytes } from "viem/ens";
import type { EnsResolution } from "@/lib/api";
import { short } from "./ui";

/**
 * The same name read through the ENSv2 UniversalResolver. It proves the page is not the source of
 * truth: any wallet or indexer walking the registry reaches the same resolver and the same values.
 */
/** What to call the chain these records live on, for the one line a reader has to fill in themselves. */
const CHAINS: Record<number, string> = { 1: "Ethereum mainnet", 11155111: "Sepolia" };

export function EnsProof({
  ens,
  name,
  chainId,
}: {
  ens: EnsResolution | null;
  name: string;
  /** Which chain to point an RPC at; without it the command below cannot say */
  chainId?: number;
}) {
  // `cast` has no DNS encoder — there is no `--to-dns-name` — so the wire-format name is written out
  // here. Everything else in the command is a cast subcommand that exists.
  const wire = toHex(packetToBytes(name));
  // Ask for a key this name actually answers on: a command returning an empty string proves nothing.
  const key = Object.entries(ens?.texts ?? {}).find(([, v]) => v)?.[0] ?? "ketsuban:answer";
  return (
    <section className="card" data-testid="ens-proof">
      {/* The proof, not the product. Everything above is what the page is for; this is here so a
          reader who does not take our word for it can check every value themselves. */}
      <details>
        <summary>Read it yourself, through ENS</summary>
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
            {/* The page turns every failure into nothing at all, so this cannot name one cause: an
              unconfigured resolver and an RPC that did not answer look identical from here. */}
            This name could not be read through ENS just now — either the deployment has no UniversalResolver
            configured, or the read did not come back. The command below is the same one this page would have
            run.
          </p>
        )}
        {/*
          Runnable, rather than illustrative.
          Without an endpoint `cast` looks for a node on localhost and fails with "failed to retrieve
          chain ID from fork endpoint" — on the one part of the page whose whole purpose is that a
          reader does not have to take its word for anything.
        */}
        <p className="muted" data-testid="ens-proof-rpc">
          Point <code>ETH_RPC_URL</code> at {CHAINS[chainId ?? 0] ?? "the chain this deployment writes to"}
          {chainId ? ` (chain ${chainId})` : ""}, which is where these records live.
        </p>
        <pre>
          <code>
            {`cast call --rpc-url "$ETH_RPC_URL" ${ens ? ens.universalResolver : "<universal-resolver>"} \\
  "resolve(bytes,bytes)(bytes,address)" \\
  ${wire} \\
  $(cast calldata "text(bytes32,string)" $(cast namehash ${name}) "${key}")`}
          </code>
        </pre>
      </details>
    </section>
  );
}
