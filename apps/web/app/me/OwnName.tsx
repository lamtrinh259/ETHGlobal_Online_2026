"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { Api } from "@/lib/api";
import type { Signer } from "@/lib/chain";
import { useContracts, useLinkOwnName } from "@/lib/hooks";

type Props = {
  api: Api;
  wallet: Address | undefined;
  domain: string;
  parentLabel: string;
  handle: string;
  getSigner: () => Promise<Signer>;
};

const LABEL_RE = /^[a-z0-9-]{3,63}$/;

/** Bring your own `.eth`: `<parentLabel>.<label>.eth` becomes an alias of `<handle>.<root>`. */
export function OwnName({ api, wallet, domain, parentLabel, handle, getSigner }: Props) {
  const contracts = useContracts(api);
  const link = useLinkOwnName(wallet);
  const [label, setLabel] = useState(handle);
  const valid = LABEL_RE.test(label);

  async function run() {
    if (!contracts.data) return;
    link.mutate({ signer: await getSigner(), bridge: contracts.data.bridge, domain, label });
  }

  return (
    <section className="card" data-testid="own-name">
      <h2>Bring your own .eth</h2>
      <p className="muted">
        Own <code>{label || "<label>"}.eth</code> on the ENSv2 registry with this wallet? Then{" "}
        <code>
          {parentLabel}.{label || "<label>"}.eth
        </code>{" "}
        will resolve to the same records as <code>{handle}</code>. The bridge checks ownership in the same
        transaction.
      </p>
      <label>
        Your .eth label
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase().trim())}
          placeholder="alice"
          data-testid="own-name-label"
        />
      </label>
      {link.error && (
        <p className="error" role="alert">
          {link.error.message}
        </p>
      )}
      {link.isSuccess && (
        <p className="muted">
          linked · tx <code>{link.data}</code>
        </p>
      )}
      <button
        className="primary"
        onClick={run}
        disabled={!valid || !contracts.data || link.isPending}
        data-testid="own-name-link"
      >
        {link.isPending ? "linking…" : "Link"}
      </button>
    </section>
  );
}
