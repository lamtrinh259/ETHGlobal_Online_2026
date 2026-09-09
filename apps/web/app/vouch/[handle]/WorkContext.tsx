"use client";

import Link from "next/link";
import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { AttestFlow, type Published } from "@/app/AttestFlow";
import { linkedDomains } from "@/lib/identity";

/**
 * Step 3 for the voucher: the accounts they already signed in with are the evidence. Linking new ones
 * belongs to the profile, so this only asks which connected account ties them to the candidate.
 */
export function WorkContext({
  candidate,
  onPublished,
}: {
  candidate: string;
  onPublished: (p: Published) => void;
}) {
  const { user } = usePrivy();
  const domains = linkedDomains(user);
  const [chosen, setChosen] = useState(domains[0]);

  if (domains.length === 0) {
    return (
      <section className="card" data-testid="no-accounts">
        <h2>Show how you know {candidate}</h2>
        <p>
          You have no accounts connected yet. Connect the one you worked from — X, GitHub, Telegram, Discord
          or an email — and come back.
        </p>
        <p>
          <Link href="/me#link" className="primary">
            Connect an account →
          </Link>
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card" data-testid="account-check">
        <h2>Show how you know {candidate}</h2>
        <p>
          You have <strong>{domains.length}</strong> account{domains.length === 1 ? "" : "s"} connected. Make
          sure the one that connects you with {candidate} is in this list.
        </p>
        <p className="row">
          {domains.map((d) => (
            <button
              type="button"
              key={d}
              className={chosen === d ? "primary" : ""}
              onClick={() => setChosen(d)}
              data-testid={`account-${d}`}
            >
              {d}
            </button>
          ))}
        </p>
        <p className="muted">
          Missing the right one? <Link href="/me#link">Connect it in your profile</Link>, then come back —
          this page remembers where you were.
        </p>
      </section>
      {chosen && (
        <AttestFlow
          key={chosen}
          fixedDomain={chosen}
          title={`Attest your ${chosen} account`}
          onPublished={onPublished}
        />
      )}
    </>
  );
}
