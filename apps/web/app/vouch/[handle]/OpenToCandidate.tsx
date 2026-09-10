"use client";

import { useState } from "react";
import { useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address, Hex } from "viem";
import type { Api, WalletDashboard } from "@/lib/api";
import { Switch } from "@/app/Switch";
import { useWebConfig } from "@/app/providers";
import { buildDisclosure, disclosureTypedData, toDisclosureWire } from "@/lib/disclose";
import { loadViewCodes } from "@/lib/keys";

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
}: {
  api: Api;
  /** The handle the reference was written for */
  candidate: string;
  rootParent: string;
  /** The writer's own name, which a permission is written against */
  voucherName: string;
  links: WalletDashboard["links"];
}) {
  const config = useWebConfig();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[]>();
  const [error, setError] = useState<string>();

  const masked = links.filter((l) => l.live && l.optedIn);
  if (masked.length === 0 || !voucherName || !rootParent) return null;
  const audienceName = `${candidate}.${rootParent}`;

  async function open() {
    setError(undefined);
    setBusy(true);
    try {
      const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
        Address | undefined;
      if (!wallet) throw new Error("no wallet yet — Privy is still creating it");
      const codes = loadViewCodes();
      const accounts = picked.map((domain) => {
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
          {candidate} can now read <strong>{done.join(", ")}</strong>. Nobody else can: the permission names
          them. You can take it back from your own page at any time, and taking it back is visible.
        </p>
      ) : (
        <>
          <p className="muted">
            Your accounts are private, so this reference does not say which one you hold. Open one to{" "}
            {candidate} and their page can show who referred them — to them, and to nobody else.
          </p>
          {masked.map((l) => (
            <Switch
              key={l.domain}
              checked={picked.includes(l.domain)}
              onChange={() =>
                setPicked((p) => (p.includes(l.domain) ? p.filter((x) => x !== l.domain) : [...p, l.domain]))
              }
              label={l.domain}
            />
          ))}
          <p>
            <button
              className="primary"
              disabled={busy || picked.length === 0}
              onClick={() => void open()}
              data-testid="open-accounts"
            >
              {busy ? "signing…" : `Open to ${candidate}`}
            </button>
          </p>
          <p className="muted">
            Or leave it closed. The reference still counts — it just stays anonymous, which is a weaker thing
            to hand somebody.
          </p>
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
