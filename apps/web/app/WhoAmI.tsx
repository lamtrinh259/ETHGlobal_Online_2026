"use client";

import Link from "next/link";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { whoAmI } from "@/lib/identity";

/** Who is signed in, in the header — the identity line belongs to the shell, not to each form. */
export function WhoAmI() {
  const { ready, authenticated, user, logout } = usePrivy();
  const { wallets } = useWallets();
  if (!ready || !authenticated) return null;
  const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address;
  const who = whoAmI(user, wallet);
  return (
    <span className="sh-who" data-testid="who">
      <Link href="/me" title={wallet ?? undefined}>
        {who.label}
      </Link>
      <button onClick={logout} className="sh-signout">
        sign out
      </button>
    </span>
  );
}
