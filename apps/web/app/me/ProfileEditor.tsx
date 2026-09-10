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
  avatar: "Shown wherever your name is read",
  description: "A line about you",
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

  const [uploading, setUploading] = useState(false);
  const [avatarError, setAvatarError] = useState<string>();

  /** A text record holds a URL, so the picture is kept first and the record points at where it landed. */
  async function pickAvatar(file: File | undefined) {
    if (!file) return;
    setAvatarError(undefined);
    setUploading(true);
    try {
      const { url } = await api.uploadAvatar(file);
      setDraft((d) => ({ ...d, avatar: url }));
    } catch (e) {
      setAvatarError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

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
        Public. Published as text records on <code>{name}</code>, so any ENS client shows it.
      </p>
      <details data-testid="profile-roles">
        <summary className="muted">Why you can write these</summary>
        <small className="muted">
          The bridge granted your wallet a role per key on this name; the resolver refuses anything else on
          chain. One transaction per changed field.
        </small>
      </details>
      {/* Your page as anyone else reads it, with the picture changed in place rather than by URL. */}
      <div className="me-head" data-testid="profile-preview">
        <label className="me-avatar" title="Change your picture">
          {draft.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element -- an arbitrary URL, not a bundled asset
            <img src={draft.avatar} alt="" width={96} height={96} />
          ) : (
            <span className="me-avatar-empty" aria-hidden />
          )}
          <span className="me-avatar-edit">{uploading ? "keeping…" : "Change"}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            onChange={(e) => void pickAvatar(e.target.files?.[0])}
            aria-label="your picture"
            data-testid="avatar-file"
          />
        </label>
        <div className="me-head-text">
          <h3>{name}</h3>
          {draft.description ? <p>{draft.description}</p> : <p className="muted">No description yet.</p>}
          {draft.url && (
            <a href={draft.url} rel="noreferrer nofollow">
              {draft.url}
            </a>
          )}
        </div>
      </div>
      {avatarError && (
        <p className="error" role="alert" data-testid="avatar-error">
          {avatarError}
        </p>
      )}

      {PUBLIC_KEYS.filter((k) => k !== "avatar").map((k) => (
        <label key={k}>
          {LABELS[k]}
          <input
            value={draft[k]}
            onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            placeholder={k === "url" ? "https://…" : ""}
            data-testid={`profile-${k}`}
          />
          <small className="muted">
            {HINTS[k]} ·{" "}
            <span data-testid={`role-${k}`}>
              role held for <code>{k}</code>
            </span>
          </small>
        </label>
      ))}

      {/* The record itself, kept in the form so what will be written is never a surprise. */}
      <label className="me-avatar-url">
        Picture URL
        <input
          value={draft.avatar}
          onChange={(e) => setDraft({ ...draft, avatar: e.target.value })}
          placeholder="https://…/me.png"
          data-testid="profile-avatar"
        />
        <small className="muted">
          {HINTS.avatar} ·{" "}
          <span data-testid="role-avatar">
            role held for <code>avatar</code>
          </span>
        </small>
      </label>

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
