"use client";

import { useState } from "react";
import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address, Hex } from "viem";
import type { Api, WalletDashboard } from "@/lib/api";
import { CopyButton } from "@/app/CopyButton";
import { useWebConfig } from "@/app/providers";
import { buildDisclosure, disclosureTypedData, revealLink, toDisclosureWire } from "@/lib/disclose";
import { loadViewCodes } from "@/lib/keys";

type Props = { api: Api; links: WalletDashboard["links"]; name: string };

/**
 * Who may read a private account. The handle is never published: the view code travels encrypted to the
 * enclave's key, so the permission can be opened there and nowhere else — not by this app, not by the
 * service that stores it, and not by the verifier who receives the answer.
 */
export function ReadPermission({ api, links, name }: Props) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const [reader, setReader] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [granted, setGranted] = useState<{ domain: string; expiresAt: string }>();
  const masked = links.filter((l) => l.live && l.optedIn);
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;

  async function allow(domain: string) {
    setError(undefined);
    setBusy(domain);
    try {
      const viewCode = loadViewCodes()[domain];
      if (!viewCode)
        throw new Error(`the view code for ${domain} is not in this browser — re-attest it to get one`);
      const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
        Address | undefined;
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      const audience = /^0x[0-9a-fA-F]{40}$/.test(reader.trim()) ? (reader.trim() as Address) : undefined;

      const { publicKey } = await api.enclaveKey();
      const { disclosure, box } = buildDisclosure({
        name,
        domain,
        viewCode: viewCode as Hex,
        enclavePubkey: publicKey,
        audience,
        now: Math.floor(Date.now() / 1000),
      });
      const { signature } = await signTypedData(
        disclosureTypedData(disclosure, config.chainId, config.multipass as Address) as never,
        { address: wallet }
      );
      const ack = await api.disclose(toDisclosureWire(disclosure, box, signature as Hex));
      setGranted({ domain, expiresAt: ack.expiresAt });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  }

  if (masked.length === 0) return null;

  return (
    <section className="card" data-testid="read-permission">
      <h2>Who can read your private accounts</h2>
      <p className="muted">
        A private account proves you control one without saying which. To let someone read it, you sign a
        permission: the code that unmasks it travels encrypted to the enclave, so the answer is given there
        and the handle is never published.
      </p>
      <label>
        One wallet only (optional)
        <input
          value={reader}
          onChange={(e) => setReader(e.target.value)}
          placeholder="0x… — leave empty for anyone with the link"
          aria-label="reader"
        />
      </label>
      <ul className="acct">
        {masked.map((l) => (
          <li key={l.domain} data-testid={`allow-${l.domain}`}>
            <span className="acct-who">{l.domain}</span>
            {/* Two records for one platform look identical without the name each answers at. */}
            <small className="muted">
              {l.ensName ? <code>{l.ensName}</code> : "private, unnamed"}
            </small>
            <span className="acct-state">
              <button onClick={() => allow(l.domain)} disabled={busy === l.domain}>
                {busy === l.domain ? "signing…" : "Allow reading"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {granted && (
        <div className="done" data-testid="granted">
          <p>
            <strong>{granted.domain} can be read</strong> until {new Date(granted.expiresAt).toUTCString()}
            {reader.trim() ? ", by that wallet only" : ", by anyone holding this link"}.
          </p>
          <code>{revealLink(siteUrl, name, granted.domain)}</code>
          <p>
            <CopyButton text={revealLink(siteUrl, name, granted.domain)} label="Copy the link" />
          </p>
        </div>
      )}
    </section>
  );
}
