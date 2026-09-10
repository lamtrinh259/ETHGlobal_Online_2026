"use client";

import { useState } from "react";
import { IDKitRequestWidget, proofOfHuman, selfieCheckLegacy } from "@worldcoin/idkit";
import { humanityError } from "@/lib/humanity";
import type { Api, HumanityChallenge } from "@/lib/api";

/**
 * Prove one human stands behind this account.
 *
 * Three steps, in this order and no other (https://docs.world.org/world-id/idkit/integrate): the
 * server signs a proof request as the app, World App produces the proof, and the server verifies it
 * and writes the record. The signature is what makes World issue a proof at all, and the key that
 * makes it never reaches here — so nothing opens until that round trip has come back.
 */
export function HumanityCheck({
  api,
  wallet,
  onVerified,
}: {
  api: Api;
  wallet: string | undefined;
  onVerified: () => void;
}) {
  const [challenge, setChallenge] = useState<HumanityChallenge>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();

  async function start() {
    if (!wallet) return;
    setError(undefined);
    try {
      setChallenge(await api.humanityChallenge(wallet));
      setOpen(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <button className="linkish" onClick={start} disabled={!wallet} data-testid="humanity-cta">
        Prove you are one person
      </button>
      {error && (
        <small className="muted" data-testid="humanity-error">
          {error}
        </small>
      )}
      {challenge && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={challenge.app_id as `app_${string}`}
          action={challenge.action}
          rp_context={challenge.rp_context}
          // Selfie Check returns World ID 3.0 proofs, and an Orb-verified person who has not moved to
          // 4.0 proves it the same way. Neither works without this.
          allow_legacy_proofs={true}
          environment={challenge.environment}
          /*
           * Which credential a person is asked for, decided by the deployment rather than here.
           * `proof_of_human` falls back to the Orb, which asks someone to find one before they can be
           * counted; Selfie Check asks for no hardware at all. The signal binds the proof to this
           * wallet, and the server refuses one bound to anything else.
           */
          preset={
            challenge.credential === "selfie"
              ? selfieCheckLegacy({ signal: challenge.signal })
              : proofOfHuman({ signal: challenge.signal })
          }
          handleVerify={async (result) => {
            // World says the proof is sound. Only this deployment can say the nullifier is unspent,
            // and only it can write the record the badge is read from. Rethrown so IDKit stops here:
            // a tick over a record that was never written is the one outcome worth avoiding.
            try {
              await api.proveHumanity(wallet as string, result);
            } catch (e) {
              setError((e as Error).message);
              throw e;
            }
          }}
          onSuccess={() => {
            setOpen(false);
            onVerified();
          }}
          onError={(code) => setError(humanityError(String(code), challenge.credential))}
        />
      )}
    </>
  );
}
