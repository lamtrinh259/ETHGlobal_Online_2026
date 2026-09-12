"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useWebConfig } from "@/app/providers";
import { apiFor, useInvite } from "@/lib/hooks";
import { describePolicy, policyFromQuery } from "@/lib/profile";

/**
 * Where an employer's invitation lands: the person's own page, carrying the code.
 *
 * The link is `/me?invite=<code>`, the same shape a vouch link has, and the attester holds the signed
 * invitation behind the code. So this says — from the record, not from the link — who is asking, what
 * they require, and which account to begin with; and once the person has a page, reads it against the
 * bar instead. It keeps asking, because the person is on this page doing exactly that: the block that
 * told them to begin should notice when they have, without a reload.
 */
export function InvitedBy({ code }: { code: string | undefined }) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const q = useInvite(api, code);
  if (!code) return null;

  if (q.isPending && /^[0-9a-f]{32}$/i.test(code)) {
    return (
      <section className="card" data-testid="invited-reading">
        <p className="muted">reading the invitation…</p>
      </section>
    );
  }
  const kept = q.data;
  if (!kept) {
    return (
      <section className="card" data-testid="invited-unknown">
        <h2>No invitation with that code</h2>
        <p className="muted">
          The link may be incomplete, or the invitation was never kept. Ask whoever sent it for a fresh one.
        </p>
      </section>
    );
  }
  // A candidate's invitation is for a writer, and its page is the vouch page; send it there.
  if (kept.kind !== "policy") {
    const handle = kept.invite.handle;
    return (
      <section className="card" data-testid="invited-to-vouch">
        <p>
          That link invites you to write a reference for <code>{handle}</code>.{" "}
          <Link className="button primary" href={`/vouch/${handle}?invite=${kept.code}`}>
            Write it
          </Link>
        </p>
      </section>
    );
  }

  const subjects = config.instances.slice(1).map((i) => i.domain);
  const policy = policyFromQuery(Object.fromEntries(new URLSearchParams(kept.policy)), subjects);
  return (
    <section className="card" data-testid="invited">
      <h2>
        <code>{kept.inviterName}</code> is inviting you
      </h2>
      <p>
        to pass their risk assessment policy. Everything it reads is a record anybody can resolve; nothing
        here is a judgement of you.
      </p>
      <p data-testid="invited-bar">
        <strong>What they require:</strong> {describePolicy(policy)}
      </p>
      {kept.expired && (
        <p className="warning" data-testid="invited-expired">
          This invitation has expired. You can still make a page; ask them for a fresh link to be read.
        </p>
      )}
      {kept.status === "claimed" && kept.candidate ? (
        <p data-testid="invited-claimed">
          {kept.platform.includes(".") ? (
            <>
              The <code>{kept.platform}</code> account <code>@{kept.account}</code> is linked to{" "}
              <code>{kept.candidate}</code>.{" "}
            </>
          ) : (
            <>
              Your page is <code>{kept.candidate}</code>.{" "}
            </>
          )}
          <Link className="button primary" href={`/p/${kept.candidate}?${kept.policy}`}>
            Read {kept.candidate} against the bar
          </Link>
        </p>
      ) : (
        <p data-testid="invited-begin">
          {kept.platform.includes(".") ? (
            <>
              <strong>
                Begin by connecting your <code>{kept.platform}</code> account <code>@{kept.account}</code>
              </strong>{" "}
              below: sign in, link it, and the page becomes yours to be read.
            </>
          ) : (
            // Named by their handle here: the page existed once and has lapsed, or was never claimed.
            <>
              <strong>
                Begin by claiming your name <code>{kept.account}</code>
              </strong>{" "}
              below: sign in, hold it, and the page is read against the bar.
            </>
          )}
          {kept.status === "linked" && (
            <span className="muted" data-testid="invited-linked">
              {" "}
              That account is linked already; what is missing is a name for the page.
            </span>
          )}
        </p>
      )}
    </section>
  );
}
