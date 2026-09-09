"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { Api } from "@/lib/api";
import { LETTER_MAX, type Signer } from "@/lib/chain";
import { useContracts, useLetterWrite } from "@/lib/hooks";

type Props = {
  api: Api;
  candidate: string;
  name: string;
  getSigner: () => Promise<Signer>;
  initial?: string;
};

/**
 * The long-form letter. The few words in the record are the part that lives in the name itself; the
 * letter is an ENS `description` text record on the same name, written by the voucher's own wallet.
 */
export function LetterForm({ api, candidate, name, getSigner, initial }: Props) {
  const contracts = useContracts(api);
  const write = useLetterWrite(candidate);
  const [letter, setLetter] = useState(initial ?? "");
  const resolver = contracts.data?.permissionedResolver as Address | null | undefined;
  const over = letter.length > LETTER_MAX;

  return (
    <section className="card" data-testid="letter-form">
      <h2>Add a letter {initial ? "" : "(optional)"}</h2>
      <p className="muted">
        Relationship, organisation, overlap period, and what you would tell someone who asked. Stored as the
        ENS <code>description</code> record on <code>{name}</code>, so any ENS client reads it. You sign this
        one yourself, from your wallet.
      </p>
      <label>
        Your letter
        <textarea
          value={letter}
          onChange={(e) => setLetter(e.target.value)}
          rows={6}
          placeholder={`I worked with ${candidate} at Acme from 2019 to 2022. They ran the platform team…`}
          aria-label="letter"
        />
        <small className={over ? "error" : "muted"} data-testid="letter-count">
          {letter.length}/{LETTER_MAX} characters
          {over ? " — trim it, a longer record costs more to write" : ""}
        </small>
      </label>
      {resolver === null && <p className="error">This deployment has no permissioned resolver configured.</p>}
      {write.error && (
        <p className="error" role="alert">
          {write.error.message}
        </p>
      )}
      {write.isSuccess && (
        <p className="muted">
          saved · tx <code>{write.data}</code>
        </p>
      )}
      <button
        className="primary"
        disabled={!letter.trim() || over || !resolver || write.isPending}
        onClick={async () => {
          if (!resolver) return;
          write.mutate({ signer: await getSigner(), resolver, name, letter: letter.trim() });
        }}
        data-testid="letter-save"
      >
        {write.isPending ? "writing…" : initial ? "Replace the letter" : "Sign and add the letter"}
      </button>
    </section>
  );
}
