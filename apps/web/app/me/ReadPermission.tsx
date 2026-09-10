"use client";

import { useMemo, useState } from "react";
import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address, Hex } from "viem";
import type { Api, WalletDashboard } from "@/lib/api";
import { CopyButton } from "@/app/CopyButton";
import { Switch } from "@/app/Switch";
import { useWebConfig } from "@/app/providers";
import {
  buildDisclosure,
  disclosureTypedData,
  revealLink,
  revocationTypedData,
  toDisclosureWire,
} from "@/lib/disclose";
import { useDisclosures, useNameStatus, useRevoke } from "@/lib/hooks";
import { loadViewCodes } from "@/lib/keys";
import { short } from "@/app/ui";

type Props = { api: Api; links: WalletDashboard["links"]; name: string };

/** `bob`, `bob.ketsuban.eth` and a raw address all mean the same person; only the last needs no lookup. */
export function readerHandle(input: string, rootParent: string): string {
  const clean = input.trim().toLowerCase().replace(/^@/, "");
  const suffix = `.${rootParent.toLowerCase()}`;
  return clean.endsWith(suffix) ? clean.slice(0, -suffix.length) : clean;
}

/** The audience a grant carries when it is for whoever holds the link. */
const ANYONE = "0x0000000000000000000000000000000000000000";

export function isAddress(input: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(input.trim());
}

/**
 * Sharing a private account. The handle is never published: the view code travels encrypted to the
 * enclave's key, so the permission can be opened there and nowhere else — not by this app, not by the
 * service that stores it, and not by the reader who receives the answer.
 *
 * Two ways to share, because they are different decisions: a link anyone may use, or one person, named
 * the way people are named here rather than by pasting an address.
 */
export function ReadPermission({ api, links, name }: Props) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const root = config.instances[0];
  const [picked, setPicked] = useState<string[]>([]);
  const [scope, setScope] = useState<"link" | "person">("link");
  const [reader, setReader] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [granted, setGranted] = useState<{ domains: string[]; expiresAt: string; audience?: Address }>();
  const live = useDisclosures(api, name);
  const revoking = useRevoke(api, name);
  const [taking, setTaking] = useState<string>();
  const masked = links.filter((l) => l.live && l.optedIn);
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;

  const typed = reader.trim();
  const handle = useMemo(() => readerHandle(typed, root?.parentName ?? ""), [typed, root?.parentName]);
  const lookup = useNameStatus(api, root?.domain ?? "", handle, scope === "person" && !isAddress(typed));
  const audience: Address | undefined = isAddress(typed)
    ? (typed as Address)
    : ((lookup.data?.live && lookup.data.wallet ? (lookup.data.wallet as Address) : undefined) ?? undefined);
  const ready = scope === "link" || !!audience;

  /**
   * Share everything picked, under one signature. Three accounts is one decision and one link, so
   * asking for three signatures would be asking the same question three times.
   */
  async function share() {
    setError(undefined);
    setBusy("share");
    try {
      const codes = loadViewCodes();
      const accounts = picked.map((domain) => {
        const viewCode = codes[domain];
        if (!viewCode)
          throw new Error(`the view code for ${domain} is not in this browser — re-attest it to get one`);
        return { domain, viewCode: viewCode as Hex };
      });
      const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
        Address | undefined;
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      const only = scope === "person" ? audience : undefined;

      const { publicKey } = await api.enclaveKey();
      const { disclosure, boxes } = buildDisclosure({
        name,
        accounts,
        enclavePubkey: publicKey,
        audience: only,
        now: Math.floor(Date.now() / 1000),
      });
      const { signature } = await signTypedData(
        disclosureTypedData(disclosure, config.chainId, config.multipass as Address) as never,
        { address: wallet }
      );
      const ack = await api.disclose(toDisclosureWire(disclosure, boxes, signature as Hex));
      setGranted({ domains: disclosure.domains, expiresAt: ack.expiresAt, audience: only });
      void live.refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  /**
   * Taking one back. Signed by the same wallet, and dated: the attester refuses a stale signature, so a
   * revocation captured today cannot be replayed to undo a share made later.
   */
  async function take(domain: string) {
    setError(undefined);
    setTaking(domain);
    try {
      const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
        Address | undefined;
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      const revocation = { name, domain, at: Math.floor(Date.now() / 1000) };
      const { signature } = await signTypedData(
        revocationTypedData(revocation, config.chainId, config.multipass as Address) as never,
        { address: wallet }
      );
      await revoking.mutateAsync({ ...revocation, at: revocation.at.toString(), signature });
      if (granted?.domains.includes(domain)) {
        const left = granted.domains.filter((d) => d !== domain);
        setGranted(left.length ? { ...granted, domains: left } : undefined);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTaking(undefined);
    }
  }

  if (masked.length === 0) return null;

  return (
    <section className="card" data-testid="read-permission">
      <h2>Share a private account</h2>
      <p className="muted">
        Each of these proves you control an account without saying which one. Sharing gives one reader the
        code that unmasks it: the enclave opens it for them and answers there, so the handle is still never
        published and this app never sees it either.
      </p>

      <h3>Which accounts</h3>
      <ul className="acct" data-testid="pick-list">
        {masked.map((l) => (
          <li key={l.domain} data-testid={`pick-${l.domain}`}>
            <Switch
              checked={picked.includes(l.domain)}
              onChange={(on) => setPicked((p) => (on ? [...p, l.domain] : p.filter((d) => d !== l.domain)))}
              label={l.domain}
              // Two records for one platform look identical without the name each answers at.
              hint={l.ensName ?? "private, unnamed"}
            />
          </li>
        ))}
      </ul>

      <h3>Who may read them</h3>
      <p className="row" role="group" aria-label="who it is for">
        <button
          className={scope === "link" ? "primary" : ""}
          onClick={() => setScope("link")}
          data-testid="scope-link"
        >
          Anyone with the link
        </button>
        <button
          className={scope === "person" ? "primary" : ""}
          onClick={() => setScope("person")}
          data-testid="scope-person"
        >
          One person
        </button>
      </p>

      {scope === "person" && (
        <>
          <label>
            Who may read it
            <input
              value={reader}
              onChange={(e) => setReader(e.target.value)}
              placeholder={`bob, bob.${root?.parentName ?? "eth"}, or 0x…`}
              aria-label="reader"
              data-testid="reader"
            />
          </label>
          <p className="muted" data-testid="reader-resolved">
            {isAddress(typed) ? (
              <>
                That wallet only: <code>{short(typed)}</code>. Nobody else can open it, link or no link.
              </>
            ) : !handle ? (
              "A name here, or a wallet address. The permission is bound to it, so only they can open it."
            ) : lookup.isFetching ? (
              "looking…"
            ) : audience ? (
              <>
                <code>
                  {handle}.{root?.parentName}
                </code>{" "}
                is held by <code>{short(audience)}</code>. Only that wallet can open it.
              </>
            ) : (
              <>
                Nobody holds{" "}
                <code>
                  {handle}.{root?.parentName}
                </code>{" "}
                here. Ask them to claim their name, or paste their wallet address.
              </>
            )}
          </p>
        </>
      )}

      <p>
        <button
          className="primary"
          onClick={() => void share()}
          disabled={busy === "share" || !ready || picked.length === 0}
          data-testid="share"
        >
          {busy === "share" ? "signing…" : picked.length > 1 ? `Share ${picked.length} accounts` : "Share"}
        </button>{" "}
        {picked.length === 0 && <small className="muted">Pick an account above to share it.</small>}
      </p>

      <h3>Who can read these now</h3>
      {!live.data ? (
        <p className="muted">reading…</p>
      ) : live.data.grants.length === 0 ? (
        <p className="muted" data-testid="granted-none">
          Nobody. Each account above stays masked until you share it, and every share can be taken back here
          afterwards.
        </p>
      ) : (
        <ul className="acct" data-testid="granted-list">
          {live.data.grants.map((g) => (
            <li key={g.domain} data-testid={`grant-${g.domain}`}>
              <span className="acct-who">{g.domain}</span>
              <small className="muted">
                {g.audience === ANYONE ? (
                  <>anyone with the link</>
                ) : (
                  <>
                    one wallet, <code>{short(g.audience)}</code>
                  </>
                )}{" "}
                · until {new Date(g.expiresAt).toUTCString()}
              </small>
              <span className="acct-state">
                <button
                  onClick={() => take(g.domain)}
                  disabled={taking === g.domain}
                  data-testid={`revoke-${g.domain}`}
                >
                  {taking === g.domain ? "signing…" : "Stop sharing"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {granted && (
        <div className="done" data-testid="granted">
          <p>
            <strong>{granted.domains.join(", ")}</strong>{" "}
            {granted.domains.length > 1 ? "can be read" : "can be read"}{" "}
            {granted.audience ? (
              <>
                by <code>{short(granted.audience)}</code> only
              </>
            ) : (
              "by anyone holding this link"
            )}
            , until {new Date(granted.expiresAt).toUTCString()}.
          </p>
          <code>{revealLink(siteUrl, name, granted.domains, granted.audience)}</code>
          <p>
            <CopyButton
              text={revealLink(siteUrl, name, granted.domains, granted.audience)}
              label="Copy the link"
            />
          </p>
        </div>
      )}
    </section>
  );
}
