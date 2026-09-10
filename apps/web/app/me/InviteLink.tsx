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
import type { Api, WalletDashboard } from "@/lib/api";
import { Modal } from "@/app/Modal";
import { PlatformPicker } from "@/app/PlatformPicker";
import { inviteTypedData } from "@/lib/intent";
import { buildDisclosure, disclosureTypedData, toDisclosureWire } from "@/lib/disclose";
import { loadViewCodes } from "@/lib/keys";
import { Switch } from "@/app/Switch";

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
  links = [],
  name = "",
}: {
  api: Api;
  handle: string;
  /** The root parent name, for the message that goes with a link */
  rootParent?: string;
  /** The holder's accounts, so a private one can be opened to the writer in the same breath */
  links?: WalletDashboard["links"];
  /** The holder's own name, which a permission is written against */
  name?: string;
}) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [shared, setShared] = useState<string[]>([]);
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
      // A writer who cannot see the private accounts is asked to vouch for someone half-visible. The
      // permission is a second statement, addressed exactly as far as the link reaches: whoever holds
      // it, which is who the invitation already lets write.
      if (shared.length > 0 && name) {
        const codes = loadViewCodes();
        const accounts = shared.map((d) => {
          const viewCode = codes[d];
          if (!viewCode) throw new Error(`the view code for ${d} is not in this browser — re-attest it`);
          return { domain: d, viewCode: viewCode as `0x${string}` };
        });
        const { publicKey } = await api.enclaveKey();
        const { disclosure, boxes } = buildDisclosure({
          name,
          accounts,
          enclavePubkey: publicKey,
          now: Math.floor(Date.now() / 1000),
        });
        const grant = await signTypedData(
          disclosureTypedData(disclosure, config.chainId, config.multipass as Address) as never,
          { address: wallet }
        );
        await api.disclose(toDisclosureWire(disclosure, boxes, grant.signature as `0x${string}`));
      }
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

          {/* The other direction: what the writer gets to see. A reference written about somebody whose
              accounts are all masked is written half blind. */}
          {name && links.some((l) => l.live && l.optedIn) && (
            <fieldset data-testid="share-with-writer">
              <legend>Let them see your private accounts</legend>
              <p className="muted">
                Opened to whoever holds this link, for as long as the permission lasts. You can take it back
                at any time, and taking it back is visible.
              </p>
              {links
                .filter((l) => l.live && l.optedIn)
                .map((l) => (
                  <Switch
                    key={l.domain}
                    checked={shared.includes(l.domain)}
                    onChange={() =>
                      setShared((p) =>
                        p.includes(l.domain) ? p.filter((x) => x !== l.domain) : [...p, l.domain]
                      )
                    }
                    label={l.domain}
                  />
                ))}
            </fieldset>
          )}
          <p>
            <button className="primary" onClick={make} disabled={busy} data-testid="make-invite">
              {busy ? "signing…" : shared.length > 0 ? "Sign the link and the permission" : "Create the link"}
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
