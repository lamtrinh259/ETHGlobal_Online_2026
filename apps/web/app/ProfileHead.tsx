import type { ReactNode } from "react";

export type HeadRecords = { name?: string; description?: string; url?: string; avatar?: string };

/**
 * The head of any page about someone: a picture, who they are, and the name that says it on chain.
 *
 * Shared by a person's verification page and a subject's page, because a reader arriving at either is
 * asking the same question first — who is this — and the answer comes from the same records.
 */
export function ProfileHead({
  ensName,
  records,
  children,
}: {
  ensName: string;
  records: HeadRecords;
  /** Anything that belongs beside the identity, such as a status badge */
  children?: ReactNode;
}) {
  const title = records.name?.trim() || ensName;
  return (
    <div className="me-head" data-testid="profile-head">
      {records.avatar ? (
        // eslint-disable-next-line @next/next/no-img-element -- an arbitrary URL, not a bundled asset
        <img
          src={records.avatar}
          alt=""
          className="me-avatar-img"
          data-testid="head-avatar"
          width={72}
          height={72}
        />
      ) : (
        <span className="me-avatar-empty" data-testid="head-avatar" aria-hidden />
      )}
      <div className="me-head-text">
        <h2>{title}</h2>
        {title !== ensName && (
          <p className="muted">
            <code>{ensName}</code>
          </p>
        )}
        {records.description && <p>{records.description}</p>}
        {records.url && (
          <a href={records.url} rel="noreferrer nofollow" data-testid="head-url">
            {records.url}
          </a>
        )}
        {children}
      </div>
    </div>
  );
}
