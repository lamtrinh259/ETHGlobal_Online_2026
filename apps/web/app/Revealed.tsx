"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallets } from "@privy-io/react-auth";
import { apiFor } from "@/lib/hooks";
import { useWebConfig } from "./providers";

/**
 * A private account opened for whoever holds the permission. A grant addressed to one wallet only opens
 * for that wallet, so the reader's own address has to travel with the request — which means this is read
 * in the browser, where the reader is known, rather than on the server, where they are not.
 */
export function Revealed({ name, domain }: { name: string; domain: string }) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const { wallets } = useWallets();
  const reader = wallets[0]?.address;
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
