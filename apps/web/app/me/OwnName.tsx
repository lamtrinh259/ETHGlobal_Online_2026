"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { Api, WalletDashboard } from "@/lib/api";
import type { Signer } from "@/lib/chain";
import { useClaimEthName, useContracts, useEthLabel, useLinkOwnName } from "@/lib/hooks";
import { FundWallet } from "./FundWallet";

type Props = {
  api: Api;
  wallet: Address | undefined;
  domain: string;
  parentLabel: string;
  handle: string;
  getSigner: () => Promise<Signer>;
  /** This wallet's balance in wei: registering a name is a transaction it sends itself */
  balance?: string;
  /** Offered when the deployment still has test ETH for this wallet */
  /** What the relay will still give this wallet, so the claim can be funded where it is needed */
  topup?: WalletDashboard["gasTopup"];
};

const LABEL_RE = /^[a-z0-9-]{3,63}$/;

/** Bring your own `.eth`: `<parentLabel>.<label>.eth` becomes an alias of `<handle>.<root>`. */
export function OwnName({ api, wallet, domain, parentLabel, handle, getSigner, balance, topup }: Props) {
  const contracts = useContracts(api);
  const link = useLinkOwnName(wallet);
  const [label, setLabel] = useState(handle);
  const valid = LABEL_RE.test(label);
  // The bridge reverts with NotNameOwner for a label this wallet does not hold, and a name registered on
  // a different ENS deployment is not on this registry at all. Say which before charging for the answer.
  const owner = useEthLabel(api, valid ? label : "");
  const held = owner.data?.owner?.toLowerCase();
  const mine = !!held && !!wallet && held === wallet.toLowerCase();
  // A test deployment lets someone register a name for themselves, so nobody is stuck without one to
  // bring. It is their wallet that registers: the registrar mints only to whoever calls it.
  const claim = useClaimEthName(() => owner.refetch());
  const registrar = contracts.data?.ethRegistrar;
  const token = contracts.data?.paymentToken;
  const resolver = contracts.data?.permissionedResolver;
  // Claiming is the person's own transaction, so an empty wallet is the thing to say first.
  const broke = balance !== undefined && BigInt(balance) === 0n;
  const canClaim = !!registrar && !!token && !!resolver && valid && !held && !!wallet && !broke;

  async function register() {
    if (!registrar || !token || !resolver || !wallet) return;
    claim.mutate({
      signer: await getSigner(),
      params: { registrar, token, resolver, label, owner: wallet, duration: 2_419_200n },
    });
  }

  async function run() {
    if (!contracts.data) return;
    link.mutate({ signer: await getSigner(), bridge: contracts.data.bridge, domain, label });
  }

  return (
    <section className="card" data-testid="own-name">
      <h2>{mine ? "Bring your own .eth" : "Your name on Ethereum"}</h2>
      <p className="muted">
        {mine ? (
          <>
            You hold <code>{label}.eth</code>. Link it and{" "}
            <code>
              {parentLabel}.{label}.eth
            </code>{" "}
            resolves to the same records as <code>{handle}</code>; the bridge checks ownership in the same
            transaction.
          </>
        ) : (
          <>
            <code>{label || "<label>"}.eth</code> is an ENS name of your own, outside this deployment
            entirely. Claim it and{" "}
            <code>
              {parentLabel}.{label || "<label>"}.eth
            </code>{" "}
            resolves to the same records as <code>{handle}</code>. You register it yourself, from this wallet:
            the registrar hands names only to whoever asks for them.
          </>
        )}
      </p>
      <label>
        Your .eth label
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value.toLowerCase().trim())}
          placeholder="alice"
          data-testid="own-name-label"
        />
      </label>
      {owner.data && !mine && (
        <p className={held ? "muted" : ""} data-testid="own-name-owner">
          {held
            ? `${label}.eth is held by ${held.slice(0, 6)}…${held.slice(-4)}, not this wallet. Try another label.`
            : `${label}.eth is free on this registry.`}
        </p>
      )}
      {broke && !held && (
        <div data-testid="own-name-gas">
          <small className="muted">Yours to send, so it needs gas.</small>
          {wallet && topup && <FundWallet api={api} wallet={wallet} balance={balance} topup={topup} />}
        </div>
      )}
      {canClaim && (
        <p className="row">
          <button onClick={register} disabled={claim.isPending} data-testid="own-name-claim">
            {claim.isPending ? "registering…" : `Claim ${label}.eth`}
          </button>
          {claim.waitingUntil ? (
            <small className="muted" data-testid="own-name-waiting">
              the registrar makes this two signatures, a minute apart
            </small>
          ) : (
            <small className="muted">you pay for the name; on this testnet the token mints itself</small>
          )}
        </p>
      )}
      {claim.error && (
        <p className="error" role="alert">
          {claim.error.message}
        </p>
      )}
      {link.error && (
        <p className="error" role="alert">
          {link.error.message}
        </p>
      )}
      {link.isSuccess && (
        <p className="muted">
          linked · tx <code>{link.data}</code>
        </p>
      )}
      <button
        className="primary"
        onClick={run}
        disabled={!valid || !mine || !contracts.data || link.isPending}
        data-testid="own-name-link"
      >
        {link.isPending ? "linking…" : "Link"}
      </button>
    </section>
  );
}
