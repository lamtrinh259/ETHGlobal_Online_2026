"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallets } from "@privy-io/react-auth";
import { apiFor } from "@/lib/hooks";
import { useWebConfig } from "./providers";
import { short } from "./ui";

/**
 * A private account opened for whoever holds the permission. A grant addressed to one wallet only opens
 * for that wallet, so the reader's own address has to travel with the request — which means this is read
 * in the browser, where the reader is known, rather than on the server, where they are not.
 */
export function Revealed({
  name,
  domain,
  audience,
}: {
  name: string;
  domain: string;
  /** The wallet the link was addressed to, carried so the page can say who has to be signed in */
  audience?: string;
}) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const { wallets } = useWallets();
  const reader = wallets[0]?.address;
  const mismatched = !!audience && (!reader || reader.toLowerCase() !== audience.toLowerCase());
  const opened = useQuery({
    queryKey: ["disclosed", name, domain, reader],
    queryFn: () => api.disclosed(name, domain, reader).catch(() => null),
    retry: false,
  });

  return (
    <section className="card" data-testid="revealed">
      <h3>Opened by the candidate</h3>
      {opened.isPending ? (
        <p className="muted">opening…</p>
      ) : opened.data ? (
        <p>
          Their <code>{opened.data.domain}</code> account is <strong>@{opened.data.disclosed.handle}</strong>{" "}
          <small className="muted">(platform id {opened.data.disclosed.platformId})</small>. You were given
          permission to read this; it was never published.
        </p>
      ) : mismatched ? (
        <p className="muted">
          This link was addressed to <code>{short(audience as string)}</code>
          {reader ? (
            <>
              , and you are signed in as <code>{short(reader)}</code>. Only the addressed wallet can open it.
            </>
          ) : (
            ". Sign in with that wallet to open it."
          )}
        </p>
      ) : (
        <p className="muted">
          No live permission to read <code>{domain}</code> for this name
          {reader ? " with this wallet" : ""}. Ask the candidate for a link, or for one addressed to your
          wallet
          {reader ? "" : " — and sign in, so this page can say which wallet you are"}.
        </p>
      )}
    </section>
  );
}
