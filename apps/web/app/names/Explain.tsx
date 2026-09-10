"use client";

import { useState } from "react";
import Link from "next/link";
import type { Contracts } from "@/lib/api";
import { explainName } from "@/lib/namespace";

/**
 * Paste a name, read what it claims. The answer comes from the mounts this deployment holds, so a name
 * that means nothing here says so rather than being flattered into something.
 */
export function Explain({ contracts, nameDomains }: { contracts: Contracts; nameDomains: string[] }) {
  const [name, setName] = useState("");
  const claim = explainName(name, contracts.instances, nameDomains);

  return (
    <section className="card" data-testid="explain">
      <h2>Read a name</h2>
      <label>
        Any name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="alice.com.discord.private-www.ketsuban.eth"
          aria-label="name"
          data-testid="explain-input"
        />
      </label>
      {claim.says && (
        <>
          <p data-testid="explain-says">{claim.says}</p>
          {claim.kind !== "unknown" && (
            <p>
              <Link href={`/v/${name.trim().toLowerCase()}`}>Check whether it resolves →</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
