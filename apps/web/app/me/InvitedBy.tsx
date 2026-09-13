"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/app/Modal";
import { useWebConfig } from "@/app/providers";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { apiFor, useInvite, useProfileRead, useWalletDashboard } from "@/lib/hooks";
import { CopyButton } from "@/app/CopyButton";
import type { Verification } from "@/lib/api";
import { assessProfile, describePolicy, policyFromQuery, profileNames } from "@/lib/profile";

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
  // Whose page is read against the bar: the one the invitation found, else the name the signed-in
  // wallet holds. The employer typed a handle; the person may hold a different one.
  const { authenticated } = usePrivy();
  const { wallets } = useWallets();
  const wallet = (wallets.find((w) => w.walletClientType === "privy") ?? wallets[0])?.address as
    Address | undefined;
  const dash = useWalletDashboard(api, authenticated ? wallet : undefined);
  const root = config.instances[0];
  const held = dash.data?.names.find((n) => n.live && n.domain === root?.domain)?.name;
  const kept = q.data;
  const handle = kept?.kind === "policy" ? (kept.candidate ?? held) : undefined;
  const read = useProfileRead(api, handle);
  const [celebrated, setCelebrated] = useState<string>();
  const [showPass, setShowPass] = useState(false);
  if (!code) return null;

  if (q.isPending && /^[0-9a-f]{32}$/i.test(code)) {
    return (
      <section className="card" data-testid="invited-reading">
        <p className="muted">reading the invitation…</p>
      </section>
    );
  }
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
  /*
   * The bar, one line per requirement, read the way the employer's page reads it. A miss carries the
   * place on this page where it is fixed; all met is said outright, since that is what the person came
   * to find out.
   */
  const checks =
    handle && read.data
      ? assessProfile(
          handle,
          profileNames(handle, config).map((name, i) => ({
            instanceDomain: config.instances[i].domain,
            name,
            v: (read.data!.names.find((n) => n.name === name)?.verification ?? null) as Verification | null,
          })),
          policy,
          read.data.vouches
        ).checks
      : undefined;
  const fixAt = (id: string) =>
    id === "identity"
      ? { href: "#name", label: "Claim your name" }
      : id === "links"
        ? { href: "#link", label: "Link an account" }
        : id.startsWith("answer:")
          ? { href: "#refer", label: "Answer it" }
          : id === "vouches" || id === "from"
            ? { href: "#invite", label: "Ask for references" }
            : id === "humanity"
              ? { href: "#humanity", label: "Pass the Selfie Check" }
              : undefined;
  const passes = !!checks && checks.every((c) => c.ok);
  const met = checks?.filter((c) => c.ok).length ?? 0;
  const pageUrl = handle
    ? `${typeof window === "undefined" ? "" : window.location.origin}/p/${handle}?${kept.policy}`
    : "";
  return (
    <section className={`card invited ${passes ? "invited-pass" : ""}`} data-testid="invited">
      <PassOnce
        code={kept.code}
        passes={passes}
        celebrated={celebrated}
        onShow={(c) => {
          setCelebrated(c);
          setShowPass(true);
        }}
      />
      {showPass && handle && (
        <Modal title="" onClose={() => setShowPass(false)}>
          <div className="invited-cheer" data-testid="invited-pass-modal">
            <div className="invited-cheer-mark" aria-hidden>
              🎉
            </div>
            <h2>You pass {kept.inviterName}&apos;s bar</h2>
            <p className="muted">
              Every requirement is met by records anybody can resolve. Send them your page.
            </p>
            <p>
              <code>{pageUrl}</code> <CopyButton text={pageUrl} label="Copy link" />
            </p>
            <p className="row">
              <Link className="button primary" href={`/p/${handle}?${kept.policy}`}>
                See it as they will →
              </Link>
              <button type="button" onClick={() => setShowPass(false)}>
                Close
              </button>
            </p>
          </div>
        </Modal>
      )}
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
      {checks && (
        <p className="invited-progress" data-testid="invited-progress">
          <strong>
            {passes ? "🎯 " : ""}
            {met} of {checks.length} met
          </strong>
          <span className="invited-bar" aria-hidden>
            <span className="invited-bar-fill" style={{ width: `${(100 * met) / checks.length}%` }} />
          </span>
        </p>
      )}
      {checks && (
        <ul className="journey invited-list" data-testid="invited-checks">
          {checks.map((c) => {
            const fix = c.ok ? undefined : fixAt(c.id);
            return (
              <li key={c.id} className={c.ok ? "done" : "todo"} data-testid={`invited-check-${c.id}`}>
                <span className="invited-mark" aria-hidden>
                  {c.ok ? "✅" : "❌"}
                </span>{" "}
                {c.ok ? "✓ " : "✗ "}
                {c.label}
                <small className="muted"> · {c.detail}</small>
                {fix && (
                  <>
                    {" "}
                    <Link className="button primary" href={fix.href}>
                      {fix.label} →
                    </Link>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {passes && handle && (
        <p className="ok" data-testid="invited-pass">
          <strong>✓ You pass {kept.inviterName}&apos;s bar.</strong> Send them your page:{" "}
          <code>{pageUrl}</code> <CopyButton text={pageUrl} label="Copy" />
          {kept.account && kept.account !== handle && (
            <span className="muted" data-testid="invited-named-other">
              {" "}
              (the invitation named <code>{kept.account}</code>; your page is <code>{handle}</code>)
            </span>
          )}
        </p>
      )}
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
      ) : handle ? null : (
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

/** Opens the celebration once per invitation and per page load, the moment the last line is met. */
function PassOnce({
  code,
  passes,
  celebrated,
  onShow,
}: {
  code: string;
  passes: boolean;
  celebrated: string | undefined;
  onShow: (code: string) => void;
}) {
  useEffect(() => {
    if (passes && celebrated !== code) onShow(code);
  }, [passes, celebrated, code, onShow]);
  return null;
}
