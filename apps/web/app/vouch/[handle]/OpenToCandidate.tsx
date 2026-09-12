"use client";

import { useEffect, useRef, useState } from "react";
import { useIdentityToken, useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address, Hex } from "viem";
import type { Api, WalletDashboard } from "@/lib/api";
import { Switch } from "@/app/Switch";
import { useWebConfig } from "@/app/providers";
import { buildDisclosure, disclosureTypedData, toDisclosureWire } from "@/lib/disclose";
import { loadViewCodes } from "@/lib/keys";
import { syncViewCodes } from "@/lib/hooks";

/**
 * A reference signed by somebody whose accounts are all masked.
 *
 * The masking works: nothing on chain says which account the writer holds, and no view code means no
 * reader can find out. That is the point of opting in — and it leaves the candidate holding a
 * reference they cannot attribute, which is worth little to them and nothing to a verifier.
 *
 * The way out is the same one the rest of the app uses: a read permission, addressed to the
 * candidate's name. It is signed here rather than sent for later, because the writer is holding the
 * view code in this browser at this moment and may never come back.
 */
export function OpenToCandidate({
  api,
  candidate,
  rootParent,
  voucherName,
  links,
  required = [],
}: {
  api: Api;
  /** The handle the reference was written for */
  candidate: string;
  rootParent: string;
  /** The writer's own name, which a permission is written against */
  voucherName: string;
  links: WalletDashboard["links"];
  /** Accounts the candidate's invitation asked for: opened to them without a choice, since that was the ask */
  required?: string[];
}) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const { identityToken } = useIdentityToken();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>();
  const [error, setError] = useState<string>();

  // An account is at a DNS domain; a record without a dot (a humanity proof, an organisation) is not one.
  const masked = links.filter((l) => l.live && l.optedIn && l.domain.includes("."));
  const must = masked.map((l) => l.domain).filter((d) => required.map((r) => r.toLowerCase()).includes(d));
  const audienceName = `${candidate}.${rootParent}`;
  // What was asked for is opened as soon as the reference exists: the invitation was the consent.
  const opened = useRef(false);
  useEffect(() => {
    if (must.length === 0 || opened.current) return;
    opened.current = true;
    void open(must);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [must.join(",")]);
  if (masked.length === 0 || !voucherName || !rootParent) return null;

  async function open(domains: string[] = [...new Set([...must, ...picked])]) {
    setError(undefined);
    setBusy(true);
    try {
      const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
        Address | undefined;
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      // The service knows the codes; the browser is only a cache of them.
      await syncViewCodes(api, identityToken);
      const codes = loadViewCodes();
      const accounts = domains.map((domain) => {
        const viewCode = codes[domain];
        if (!viewCode) {
          throw new Error(`the view code for ${domain} is not in this browser — re-attest it to get one`);
        }
        return { domain, viewCode: viewCode as Hex };
      });
      const { publicKey } = await api.enclaveKey();
      const { disclosure, boxes } = buildDisclosure({
        name: voucherName,
        accounts,
        enclavePubkey: publicKey,
        // Addressed to the name rather than to a wallet: the candidate proves it on chain when they
        // read, and the permission holds even if they have not claimed it yet.
        audienceName,
        now: Math.floor(Date.now() / 1000),
      });
      const { signature } = await signTypedData(
        disclosureTypedData(disclosure, config.chainId, config.multipass as Address) as never,
        { address: wallet }
      );
      await api.disclose(toDisclosureWire(disclosure, boxes, signature as Hex));
      setDone(disclosure.domains);
      setPicked([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" data-testid="open-to-candidate">
      <h3>Let {candidate} see who wrote this</h3>
      {done ? (
        <p data-testid="opened">
          {candidate} can now read <strong>{done.join(", ")}</strong>; nobody else. Revocable from your page.
        </p>
      ) : (
        <>
          <p className="muted">
            Your accounts are private. Open one to {candidate} and they see who wrote this; nobody else does.
          </p>
          {must.length > 0 && (
            <p data-testid="opening-required">
              {candidate} asked for <strong>{must.join(", ")}</strong>: opened to them as part of this
              reference.
            </p>
          )}
          {masked
            .filter((l) => !must.includes(l.domain))
            .map((l) => (
              <Switch
                key={l.domain}
                checked={picked.includes(l.domain)}
                onChange={() =>
                  setPicked((p) =>
                    p.includes(l.domain) ? p.filter((x) => x !== l.domain) : [...p, l.domain]
                  )
                }
                label={l.domain}
              />
            ))}
          <p>
            <button
              className="primary"
              disabled={busy || (picked.length === 0 && must.length === 0)}
              onClick={() => void open()}
              data-testid="open-accounts"
            >
              {busy ? "signing…" : `Open to ${candidate}`}
            </button>
          </p>
          {must.length === 0 && (
            <p className="muted">Or leave it closed: the reference still counts, anonymously.</p>
          )}
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
