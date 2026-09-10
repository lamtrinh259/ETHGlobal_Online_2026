"use client";

import { useState } from "react";
import { useAddFunds } from "@privy-io/react-auth";
import { formatEther, type Address } from "viem";
import type { Api, WalletDashboard } from "@/lib/api";
import { CopyButton } from "@/app/CopyButton";
import { useWebConfig } from "@/app/providers";
import { useGasTopup } from "@/lib/hooks";

/**
 * Enough ether to send one transaction. Writing an ENS record costs far less than this on a test
 * chain, so anything above it is not worth asking anybody to top up.
 */
export const ENOUGH_WEI = 10_000_000_000_000_000n;

type Props = {
  api: Api;
  wallet: Address;
  /** Wei, as the dashboard reports it */
  balance: string;
  topup: WalletDashboard["gasTopup"];
};

/**
 * Getting gas into the wallet, in the order that actually works here: the relay's test ether first,
 * then Privy's own funding flow, then the address for anyone who would rather send it themselves.
 *
 * Records are relayed, but writing an ENS profile or claiming a name is a transaction the person sends,
 * so this is the one moment they need a funded wallet at all.
 */
export function FundWallet({ api, wallet, balance, topup }: Props) {
  const config = useWebConfig();
  const gas = useGasTopup(wallet);
  const { addFunds } = useAddFunds();
  const [opening, setOpening] = useState(false);
  const held = BigInt(balance);
  const enough = held >= ENOUGH_WEI;

  return (
    <div data-testid="fund-wallet">
      <p className="muted" data-testid="balance">
        Your wallet holds <strong>{formatEther(held)} ETH</strong>.{" "}
        {enough
          ? "That is enough for the transactions this app asks you to send."
          : "Writing an ENS record or claiming a name is a transaction you send yourself, so it needs a little ether."}
      </p>

      {!enough && (
        <p className="row">
          {topup.available && (
            <button
              className="primary"
              onClick={() => gas.mutate(api)}
              disabled={gas.isPending}
              data-testid="get-gas"
            >
              {gas.isPending ? "sending…" : `Get ${formatEther(BigInt(topup.amount))} test ETH`}
            </button>
          )}
          <button
            onClick={() => {
              setOpening(true);
              // Privy takes the destination as CAIP-2; the zero asset is the chain's own ether.
              void addFunds({
                destination: {
                  address: wallet,
                  chain: `eip155:${config.chainId}`,
                  asset: "0x0000000000000000000000000000000000000000",
                },
                crypto: {},
              })
                .catch(() => undefined)
                .finally(() => setOpening(false));
            }}
            disabled={opening}
            data-testid="fund-privy"
          >
            {opening ? "opening…" : "Fund it yourself"}
          </button>
        </p>
      )}

      {gas.error && (
        <p className="error" role="alert">
          {gas.error.message}
        </p>
      )}
      {gas.isSuccess && (
        <p className="muted">
          sent · tx <code>{gas.data.hash}</code>
        </p>
      )}

      <p className="muted">
        Or send some to <code data-testid="fund-address">{wallet}</code>{" "}
        <CopyButton text={wallet} label="Copy the address" />
      </p>
    </div>
  );
}
