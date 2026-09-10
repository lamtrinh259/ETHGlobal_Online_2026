"use client";

import type { ReactNode } from "react";
import type { ScorePart } from "@/lib/score";
import { ScoreRing } from "./ScoreRing";

/** The profile as the resolver answers it: every key may simply be unset. */
type Profile = {
  avatar: string | null;
  description: string | null;
  url: string | null;
  email?: string | null;
};

/**
 * Who you are and how far you have got, in one card.
 *
 * The name, what it resolves to, and whether you have proved you are one person are all facts about
 * the same subject, so they read as one thing rather than as three steps in a sequence.
 */
export function ProfileHeader({
  name,
  handle,
  profile,
  humanity,
  score,
  parts,
  onClaim,
  editor,
  accounts,
}: {
  name?: string;
  handle?: string;
  profile?: Profile;
  humanity: { level: string; until: string | null } | null;
  score: number;
  parts: ScorePart[];
  onClaim: () => void;
  /** The profile fields, folded away: reading the header should not mean scrolling past a form */
  editor?: ReactNode;
  /** The accounts behind the name: part of who you are, so they live here rather than in a step */
  accounts?: ReactNode;
}) {
  return (
    <section className="card profile-header" id="name" data-testid="profile-header">
      <div className="me-head">
        {profile?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element -- an arbitrary URL, not a bundled asset
          <img src={profile.avatar} alt="" className="me-avatar-img" width={72} height={72} />
        ) : (
          <span className="me-avatar-empty" aria-hidden />
        )}
        <div className="me-head-text">
          {name ? <h2>{name}</h2> : <h2 className="muted">No name yet</h2>}
          {profile?.description && <p>{profile.description}</p>}
          {profile?.url && (
            <a href={profile.url} rel="noreferrer nofollow">
              {profile.url}
            </a>
          )}
          <p className="row">
            <span className={`badge ${humanity ? "badge-private" : "badge-public"}`} data-testid="humanity">
              {humanity ? `human · verified` : "human · unverified"}
            </span>
            {!humanity && (
              <button className="linkish" disabled title="Partner access pending" data-testid="humanity-cta">
                Run the face check
              </button>
            )}
          </p>
        </div>
      </div>

      <ScoreRing score={score} parts={parts} />

      {!name && (
        <p>
          <button className="primary" onClick={onClaim} data-testid="claim">
            Claim your name
          </button>{" "}
          <small className="muted">Waiting letters attach to it.</small>
        </p>
      )}
      {name && handle && editor && (
        <details data-testid="edit-profile">
          <summary className="muted">Edit your public profile</summary>
          {editor}
        </details>
      )}

      {accounts && (
        <div id="accounts" className="profile-accounts">
          <h3>Social accounts</h3>
          {accounts}
        </div>
      )}
    </section>
  );
}
