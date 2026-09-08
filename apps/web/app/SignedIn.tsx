"use client";

import Link from "next/link";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { short } from "./ui";

/** Home-page strip for a returning user: who they are and where to continue. */
export function SignedIn() {
  const { ready, authenticated, user } = usePrivy();
  const { wallets } = useWallets();
  if (!ready || !authenticated) return null;
  const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address;
  const who =
    user?.twitter?.username ??
    user?.github?.username ??
    user?.telegram?.username ??
    user?.google?.email ??
    user?.email?.address ??
    (wallet ? short(wallet) : "signed in");
  return (
    <p className="row muted" data-testid="signed-in">
      <span>
        Welcome back, <strong>{who}</strong>.
      </span>
      <Link href="/me">Your dashboard →</Link>
      <Link href="/claim">Continue claiming →</Link>
    </p>
  );
}
