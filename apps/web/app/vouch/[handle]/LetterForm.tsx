"use client";

import { useState } from "react";
import type { Address } from "viem";
import type { Api } from "@/lib/api";
import { LETTER_MAX, type Signer } from "@/lib/chain";
import { LetterField, letterBytes } from "./LetterField";
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
  const keep = async (text: string) => {
    setKeeping(true);
    try {
      return await api.storeLetter(text);
    } finally {
      setKeeping(false);
    }
  };
  const resolver = contracts.data?.permissionedResolver as Address | null | undefined;
  const [keeping, setKeeping] = useState(false);
  const [failed, setFailed] = useState<string>();
  // A text record costs gas by the byte, so a long letter goes to the attester and only its hash goes
  // on chain. Short letters stay on the record, where nothing but the chain has to survive.
  const byHash = letterBytes(letter) > LETTER_MAX;

  return (
    <section className="card" data-testid="letter-form">
      <h2>Add a letter {initial ? "" : "(optional)"}</h2>
      <p className="muted">
        The ENS <code>description</code> on <code>{name}</code>, signed by your own wallet.
      </p>
      <LetterField value={letter} onChange={setLetter} candidate={candidate} />
      {resolver === null && <p className="error">This deployment has no permissioned resolver configured.</p>}
      {failed && (
        <p className="error" role="alert">
          {failed}
        </p>
      )}
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
        disabled={!letter.trim() || !resolver || write.isPending || keeping}
        onClick={async () => {
          if (!resolver) return;
          setFailed(undefined);
          const text = letter.trim();
          try {
            // Keep it first: a record pointing at a letter nobody kept would be worse than no record.
            const onChain = byHash ? (await keep(text)).ref : text;
            write.mutate({ signer: await getSigner(), resolver, name, letter: onChain });
          } catch (e) {
            setFailed((e as Error).message);
          }
        }}
        data-testid="letter-save"
      >
        {keeping
          ? "keeping the letter…"
          : write.isPending
            ? "writing…"
            : initial
              ? "Replace the letter"
              : "Sign and add the letter"}
      </button>
    </section>
  );
}
