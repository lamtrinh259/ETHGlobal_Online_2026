"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWallets } from "@privy-io/react-auth";
import { ApiError } from "@/lib/api";
import { apiFor, useWalletDashboard } from "@/lib/hooks";
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
  const reader = wallets[0]?.address as `0x${string}` | undefined;
  // A grant can be addressed to a branch rather than a wallet. The reader offers a name they hold; the
  // attester resolves it and refuses anything that does not answer with this very wallet.
  const mine = useWalletDashboard(api, reader);
  const readerName = mine.data?.names.find((n) => n.live && n.ensName)?.ensName;
  const mismatched = !!audience && (!reader || reader.toLowerCase() !== audience.toLowerCase());
  const opened = useQuery({
    queryKey: ["disclosed", name, domain, reader, readerName],
    // A grant that was taken back or ran out answers 403, one that never existed 404. The reader is
    // exactly the person who needs to know which, so the refusal is kept rather than flattened.
    queryFn: () =>
      api
        .disclosed(name, domain, reader, readerName)
        .then((d) => ({ ok: true as const, d }))
        .catch((e: unknown) => ({
          ok: false as const,
          stopped: e instanceof ApiError && e.status === 403,
        })),
    retry: false,
  });
  const answer = opened.data?.ok ? opened.data.d : undefined;
  const stopped = opened.data && !opened.data.ok && opened.data.stopped;

  return (
    <section className="card" data-testid="revealed">
      <h3>Opened by the candidate</h3>
      {opened.isPending ? (
        <p className="muted">opening…</p>
      ) : answer ? (
        <p>
          Their <code>{answer.domain}</code> account is <strong>@{answer.disclosed.handle}</strong>{" "}
          <small className="muted">(platform id {answer.disclosed.platformId})</small>. You were given
          permission to read this; it was never published.
        </p>
      ) : stopped && !mismatched ? (
        <p className="muted" data-testid="revealed-stopped">
          They are no longer sharing <code>{domain}</code>: the permission was taken back or ran out. The
          account is masked again, and asking again is a question for them, not for this page.
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
