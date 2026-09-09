"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { Api } from "@/lib/api";
import { PROFILE_KEYS, type ProfileKey, type Signer } from "@/lib/chain";
import { useContracts, useProfileWrite, useVerification } from "@/lib/hooks";

type Props = { api: Api; name: string; getSigner: () => Promise<Signer> };

const LABELS: Record<ProfileKey, string> = {
  avatar: "Avatar URL",
  description: "Description",
  url: "Website",
  email: "Email",
};

/** ENS profile records on `<handle>.<root>` — written by the wallet itself (the bridge granted ROLE_SET_TEXT). */
export function ProfileEditor({ api, name, getSigner }: Props) {
  const contracts = useContracts(api);
  const verification = useVerification(api, name);
  const write = useProfileWrite(name);
  const [draft, setDraft] = useState<Record<ProfileKey, string>>({
    avatar: "",
    description: "",
    url: "",
    email: "",
  });
  const current = verification.data?.profile;

  useEffect(() => {
    if (!current) return;
    setDraft({
      avatar: current.avatar ?? "",
      description: current.description ?? "",
      url: current.url ?? "",
      email: current.email ?? "",
    });
  }, [current]);

  const changes = Object.fromEntries(
    PROFILE_KEYS.filter((k) => draft[k] !== (current?.[k] ?? "")).map((k) => [k, draft[k]])
  ) as Partial<Record<ProfileKey, string>>;
  const dirty = Object.keys(changes).length;
  const resolver = contracts.data?.permissionedResolver as Address | null | undefined;

  async function save() {
    if (!resolver) return;
    write.mutate({ signer: await getSigner(), resolver, changes });
  }

  if (contracts.data && resolver === null) {
    return (
      <section className="card" data-testid="profile-editor">
        <h2>ENS profile</h2>
        <p className="error" role="alert">
          This deployment has no permissioned resolver configured, so these records cannot be written. Set{" "}
          <code>PERMISSIONED_RESOLVER</code> on the attester and reload.
        </p>
      </section>
    );
  }

  return (
    <section className="card" data-testid="profile-editor">
      <h2>ENS profile</h2>
      <p className="muted">
        Standard text records on <code>{name}</code>: any ENS client shows them. Each changed field is one
        transaction from your wallet.
      </p>
      <p className="muted" data-testid="profile-roles">
        These four keys are yours because the bridge granted your wallet a role for each of them, on this
        name, when the record landed. The resolver enforces it: any other key on this name, and this name
        from any other wallet, is refused on chain rather than by this page.
      </p>
      {PROFILE_KEYS.map((k) => (
        <label key={k}>
          {LABELS[k]}
          <input
            value={draft[k]}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            placeholder={k === "avatar" ? "https://…/me.png" : k === "url" ? "https://…" : ""}
            data-testid={`profile-${k}`}
          />
        </label>
      ))}

      {write.error && (
        <p className="error" role="alert">
          {write.error.message}
        </p>
      )}
      {write.isSuccess && <p className="muted">saved · {write.data.length} transaction(s)</p>}
      <button
        className="primary"
        onClick={save}
        disabled={!dirty || !resolver || write.isPending}
        data-testid="profile-save"
      >
        {write.isPending
          ? "writing…"
          : dirty
            ? `Save ${dirty} record${dirty > 1 ? "s" : ""}`
            : "Nothing to save"}
      </button>
    </section>
  );
}
