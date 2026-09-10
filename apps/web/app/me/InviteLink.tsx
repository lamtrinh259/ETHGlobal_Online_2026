"use client";

import { useState } from "react";
import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { ZERO_ADDRESS, type SignedInvite } from "@ketsuban/registrar";
import { useWebConfig } from "@/app/providers";
import { CopyButton } from "@/app/CopyButton";
import type { Api } from "@/lib/api";
import { inviteTypedData } from "@/lib/intent";

const WEEK = 7 * 24 * 3600;

/**
 * The candidate's invitation: a signature, not a transaction. A vouch domain belongs to its
 * candidate, so the enclave refuses a statement written there without one. Open by default — whoever
 * holds the link may write one reference — and valid for a week.
 */
/** Accounts a candidate commonly wants seen before a reference counts as one they asked for. */
const OFFERED = ["linkedin.com", "github.com", "x.com"] as const;

export function InviteLink({ api, handle }: { api: Api; handle: string }) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;

  async function make() {
    setError(undefined);
    setBusy(true);
    try {
      const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
        Address | undefined;
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      // A domain is a domain however it was typed, and what is asked for has to be what was signed.
      const requires = [...picked, ...(domain.trim() ? [domain.trim()] : [])].map((d) => d.toLowerCase());
      const invite = {
        handle,
        voucher: ZERO_ADDRESS,
        exp: BigInt(Math.floor(Date.now() / 1000) + WEEK),
        requires,
      };
      const { signature } = await signTypedData(
        inviteTypedData(invite, config.chainId, config.multipass as Address) as never,
        { address: wallet }
      );
      // The attester keeps the signed invitation and hands back a code, so the link fits in a message.
      const { code } = await api.storeInvite({
        ...invite,
        exp: invite.exp.toString(),
        signature: signature as `0x${string}`,
      });
      setLink(`${siteUrl.replace(/\/$/, "")}/vouch/${handle}?invite=${code}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">
        Anyone can refer you; an invite marks the ones you asked for. A signature, not a transaction — no gas,
        expires in seven days.
      </p>
      <p className="row" role="group" aria-label="what the writer should have attested">
        {OFFERED.map((d) => (
          <button
            key={d}
            className={picked.includes(d) ? "primary" : ""}
            onClick={() => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}
            data-testid={`require-${d}`}
          >
            {d}
          </button>
        ))}
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="or an email domain, e.g. mit.edu"
          aria-label="required email domain"
          data-testid="require-domain"
        />
      </p>
      {link ? (
        <>
          <code data-testid="invite-link">{link}</code>
          <p>
            <CopyButton text={link} label="Copy the invite link" />{" "}
            <button onClick={make}>Make another</button>
          </p>
        </>
      ) : (
        <p>
          <button className="primary" onClick={make} disabled={busy} data-testid="make-invite">
            {busy ? "signing…" : "Create an invite link"}
          </button>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
