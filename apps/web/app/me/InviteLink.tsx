"use client";

import { useState } from "react";
import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { ZERO_ADDRESS, type SignedInvite } from "@ketsuban/registrar";
import { useWebConfig } from "@/app/providers";
import { CopyButton } from "@/app/CopyButton";
import { fmtUtc } from "@/app/ui";
import { useInvites } from "@/lib/hooks";
import { vouchRequest } from "@/lib/profile";
import type { Api } from "@/lib/api";
import { Modal } from "@/app/Modal";
import { PlatformPicker } from "@/app/PlatformPicker";
import { inviteTypedData } from "@/lib/intent";

const WEEK = 7 * 24 * 3600;

/**
 * The candidate's invitation: a signature, not a transaction. A vouch domain belongs to its
 * candidate, so the enclave refuses a statement written there without one. Open by default — whoever
 * holds the link may write one reference — and valid for a week.
 */
export function InviteLink({
  api,
  handle,
  rootParent = "",
}: {
  api: Api;
  handle: string;
  /** The root parent name, for the message that goes with a link */
  rootParent?: string;
}) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [domain, setDomain] = useState("");
  const [open, setOpen] = useState(false);
  const made = useInvites(api, handle);
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
      setOpen(false);
      void made.refetch();
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

      <p>
        <button className="primary" onClick={() => setOpen(true)} data-testid="open-invite">
          {made.data?.invites.length ? "Create another invite link" : "Create an invite link"}
        </button>
      </p>

      {/* Kept server-side, so closing the page does not lose a link the candidate already signed. */}
      {made.data && made.data.invites.length > 0 && (
        <ul className="acct" data-testid="invites">
          {made.data.invites.map((i) => {
            const url = `${siteUrl.replace(/\/$/, "")}/vouch/${handle}?invite=${i.code}`;
            return (
              <li key={i.code} data-testid={`invite-${i.code}`}>
                <span className="acct-id">
                  <strong>
                    <code>{i.code}</code>
                  </strong>
                  <small className="muted">
                    {i.requires.length ? `asks for ${i.requires.join(", ")}` : "asks for nothing"} · until{" "}
                    {fmtUtc(i.expiresAt)}
                  </small>
                </span>
                <span className="acct-state">
                  <CopyButton text={url} label="Copy link" />
                  <CopyButton
                    text={vouchRequest(handle, siteUrl, rootParent, { code: i.code, requires: i.requires })}
                    label="Copy the ask"
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* What to ask of the writer is a decision, so it is made in a dialog rather than sitting open
          on the page waiting to be noticed. */}
      {open && (
        <Modal title="Create an invite link" onClose={() => setOpen(false)}>
          <p className="muted">Ask for accounts the writer should have attested, or ask for nothing.</p>
          <PlatformPicker
            selected={picked}
            onToggle={(d) => setPicked((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}
          />
          <label>
            Or an email domain
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="mit.edu"
              aria-label="required email domain"
              data-testid="require-domain"
            />
          </label>
          <p>
            <button className="primary" onClick={make} disabled={busy} data-testid="make-invite">
              {busy ? "signing…" : "Create the link"}
            </button>
          </p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}
