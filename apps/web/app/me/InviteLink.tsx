"use client";

import { useState } from "react";
import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { ZERO_ADDRESS, type SignedInvite } from "@ketsuban/registrar";
import { useWebConfig } from "@/app/providers";
import { CopyButton } from "@/app/CopyButton";
import { inviteLink, inviteTypedData } from "@/lib/intent";

const WEEK = 7 * 24 * 3600;

/**
 * The candidate's invitation: a signature, not a transaction. A vouch domain belongs to its
 * candidate, so the enclave refuses a statement written there without one. Open by default — whoever
 * holds the link may write one reference — and valid for a week.
 */
export function InviteLink({ handle }: { handle: string }) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const [link, setLink] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const siteUrl = typeof window === "undefined" ? "" : window.location.origin;

  async function make() {
    setError(undefined);
    setBusy(true);
    try {
      const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
        Address | undefined;
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      const invite = {
        handle,
        voucher: ZERO_ADDRESS,
        exp: BigInt(Math.floor(Date.now() / 1000) + WEEK),
      };
      const { signature } = await signTypedData(
        inviteTypedData(invite, config.chainId, config.multipass as Address) as never,
        { address: wallet }
      );
      setLink(inviteLink(siteUrl, handle, { ...invite, signature } as SignedInvite));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">
        Only people you invite can write a reference for you. The invite is a signature, not a transaction: no
        gas, and it expires in seven days.
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
