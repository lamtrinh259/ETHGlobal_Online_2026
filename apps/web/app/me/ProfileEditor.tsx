"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import type { Api } from "@/lib/api";
import { PROFILE_KEYS, type ProfileKey, type Signer } from "@/lib/chain";
import { useContracts, useProfileWrite, useVerification } from "@/lib/hooks";

type Props = { api: Api; name: string; getSigner: () => Promise<Signer> };

/**
 * What this page offers to publish. The bridge grants a role for `email` too, but an email typed here
 * would be a public text record — the opposite of the attested account, which proves the address
 * without naming it. The accounts section is where an address belongs.
 */
const PUBLIC_KEYS = ["avatar", "description", "url"] as const satisfies readonly ProfileKey[];

const LABELS: Record<(typeof PUBLIC_KEYS)[number], string> = {
  avatar: "Public avatar",
  description: "Description",
  url: "Website",
};

const HINTS: Record<(typeof PUBLIC_KEYS)[number], string> = {
  avatar: "A picture anyone reading your name will see",
  description: "A line about you, shown wherever this name is read",
  url: "Somewhere of your own",
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
    PUBLIC_KEYS.filter((k) => draft[k] !== (current?.[k] ?? "")).map((k) => [k, draft[k]])
  ) as Partial<Record<ProfileKey, string>>;
  const dirty = Object.keys(changes).length;
  const resolver = contracts.data?.permissionedResolver as Address | null | undefined;

  async function save() {
    if (!resolver) return;
    write.mutate({ signer: await getSigner(), resolver, changes });
  }

  if (contracts.data && resolver === null) {
    return (
      <div data-testid="profile-editor">
        <p className="error" role="alert">
          This deployment has no permissioned resolver configured, so these records cannot be written. Set{" "}
          <code>PERMISSIONED_RESOLVER</code> on the attester and reload.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="profile-editor">
      <p className="muted">
        This part is public and meant to be read. It is published as text records on <code>{name}</code>, so
        any ENS client shows it — not only this app. Your accounts stay masked; nothing here reveals them.
      </p>
      <p className="muted" data-testid="profile-roles">
        Each of these keys is yours because the bridge granted your wallet a role for it, on this name, when
        the record landed. The resolver enforces that: any other key on this name, and this name from any
        other wallet, is refused on chain rather than by this page. Each changed field is one transaction.
      </p>
      {/* The records as they stand, read back from the resolver: this is what anyone else sees. */}
      <div className="ens-profile" data-testid="profile-preview">
        {draft.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary URL, not a bundled asset
          <img src={draft.avatar} alt="" className="ens-avatar" width={48} height={48} />
        ) : (
          <span className="ens-avatar ens-avatar-empty" aria-hidden />
        )}
        <div>
          <strong>{name}</strong>
          {draft.description ? <p>{draft.description}</p> : <p className="muted">No description yet.</p>}
          {draft.url && (
            <a href={draft.url} rel="noreferrer nofollow">
              {draft.url}
            </a>
          )}
        </div>
      </div>

      {PUBLIC_KEYS.map((k) => (
        <label key={k}>
          {LABELS[k]}
          <input
            value={draft[k]}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            placeholder={k === "avatar" ? "https://…/me.png" : k === "url" ? "https://…" : ""}
            data-testid={`profile-${k}`}
          />
          <small className="muted">
            {HINTS[k]} ·{" "}
            <span data-testid={`role-${k}`}>
              your wallet holds the role for <code>{k}</code> on this name
            </span>
          </small>
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
    </div>
  );
}
