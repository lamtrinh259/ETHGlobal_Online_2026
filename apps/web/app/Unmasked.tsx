"use client";

import { useEffect, useMemo, useState } from "react";
import { useVerification, useViewCodeSync } from "@/lib/hooks";
import { apiFor } from "@/lib/hooks";
import { useWebConfig } from "./providers";
import { useIdentityToken } from "@privy-io/react-auth";
import { loadGivenCodes, saveGivenCode } from "@/lib/keys";
import type { Hex } from "viem";

/**
 * A masked account opened by a view code out of the link's fragment.
 *
 * The code is the one-time pad that unmasks an account on chain: permanent, unrevocable, and the whole
 * secret. It used to arrive as `?viewCode=0x…`, which put it in this app's access log, in the
 * attester's, in every proxy between them and in the reader's own history — and a secret that never
 * expires cannot be taken back once it is written down somewhere.
 *
 * The fragment is the half of a URL a browser keeps to itself, so nothing upstream ever sees it. That
 * also means only the browser can read it, which is why this is a client component and why the page
 * behind it renders masked.
 */
export function Unmasked({ name, domains }: { name: string; domains: string[] }) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const { identityToken } = useIdentityToken();
  // What the service kept for this session comes down first: a verifier who was given the code on
  // another device opens the page here without the link.
  const synced = useViewCodeSync(api);
  const [code, setCode] = useState<string>();
  useEffect(() => {
    // A code in the link is kept: here, by the name it opens, and with the service against the
    // session, so the page opens again without the link, on any device. Nothing in the URL is kept
    // longer than this read; the fragment never reaches a server.
    const found = /(?:^|[#&])viewCode=(0x[0-9a-fA-F]{64})/.exec(window.location.hash)?.[1] as Hex | undefined;
    if (found) saveGivenCode(name, found);
    setCode(found ?? loadGivenCodes()[name.toLowerCase()]);
  }, [name, synced.data]);
  useEffect(() => {
    if (code && identityToken) void api.keepViewCode(identityToken, name, code as Hex).catch(() => undefined);
  }, [api, code, identityToken, name]);

  const read = useVerification(api, code ? name : "", { links: domains, viewCode: code as `0x${string}` });
  if (!code) return null;
  const opened = (read.data?.links ?? []).filter((l) => l.disclosed);

  return (
    <section className="card" data-testid="unmasked">
      <h3>Opened by the view code you were given</h3>
      {read.isPending ? (
        <p className="muted">opening…</p>
      ) : read.isError ? (
        // Not "your code is wrong": nothing was read, and the reader is holding a code somebody gave
        // them on purpose.
        <p className="warning" data-testid="unmasked-unread">
          That could not be read just now, which says nothing about the code you were given.
        </p>
      ) : opened.length === 0 ? (
        <p className="muted" data-testid="unmasked-none">
          That code opens nothing here. A view code belongs to one account on one name; this one does not
          match any of them.
        </p>
      ) : (
        <ul data-testid="unmasked-links">
          {opened.map((l) => (
            <li key={l.domain}>
              <code>{l.domain}</code> — <strong>@{l.disclosed?.handle}</strong>{" "}
              <small className="muted">(platform id {l.disclosed?.platformId})</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
