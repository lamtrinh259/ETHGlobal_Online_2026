"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrivy, useSignTypedData, useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { CopyButton } from "@/app/CopyButton";
import { HumanMark } from "@/app/HumanMark";
import { PolicyForm } from "@/app/PolicyForm";
import { PersonSearch } from "@/app/PersonSearch";
import { useWebConfig } from "@/app/providers";
import { apiFor, useGraph, useInvites, useProfile, useReadings, useWalletDashboard } from "@/lib/hooks";
import { policyInviteTypedData } from "@/lib/intent";
import { nameRows } from "@/lib/journey";
import { loadPolicies, type SavedPolicy } from "@/lib/policies";
import { policyInviteLink, policyInviteStatusText, policyInviteText } from "@/lib/policy-invite";
import { loadShortlist, shortlist, unshortlist, type Shortlisted } from "@/lib/shortlist";
import {
  assessProfile,
  describePolicy,
  POLICY_PRESETS,
  policyToQuery,
  presetPolicy,
  type Policy,
} from "@/lib/profile";

/**
 * The side that hires, which checks a list rather than a person.
 *
 * Everything here existed already, one candidate at a time: a bar, a link carrying it, and a reading
 * of somebody against it. What was missing is that an employer does not read one page — they hold a
 * shortlist, ask the same thing of all of it, and want to see which of them cleared it without
 * opening each in turn.
 *
 * The bar and the list stay in the browser. Who somebody is considering, and what they require, says
 * as much about them as about the candidates, and is nobody else's to hold.
 */
export function Employers({ subjectDomains }: { subjectDomains: string[] }) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const [policy, setPolicy] = useState<Policy>(() => presetPolicy(POLICY_PRESETS[0], subjectDomains));
  const [named, setNamed] = useState<string | undefined>(POLICY_PRESETS[0]?.id);
  const [mine, setMine] = useState<SavedPolicy[]>([]);
  const [list, setList] = useState<Shortlisted[]>([]);
  const [building, setBuilding] = useState(false);
  const [note, setNote] = useState("");
  const [pick, setPick] = useState("");
  /** A policy by its name, preset or saved; a name nobody has leaves the bar as it is. */
  const choose = (name: string) => {
    const key = name.trim().toLowerCase();
    const preset = POLICY_PRESETS.find((p) => p.label.toLowerCase() === key || p.id === key);
    if (preset) {
      setPolicy(presetPolicy(preset, subjectDomains));
      setNamed(preset.id);
      return;
    }
    const saved = mine.find((m) => m.name.toLowerCase() === key);
    if (saved) {
      setPolicy(saved.policy);
      setNamed(saved.name);
    }
  };
  useEffect(() => {
    setMine(loadPolicies());
    setList(loadShortlist());
  }, []);

  const site = typeof window === "undefined" ? "" : window.location.origin;
  const query = policyToQuery(policy, named);

  /*
   * Who is asking.
   *
   * An invitation to somebody with no page yet says "X is inviting you", and X has to be a name the
   * employer holds, signed by the wallet that holds it — otherwise the line is one this app made up.
   * So inviting needs the employer signed in and named; the list of who they invited hangs off the
   * same name, which is where a pending check lives.
   */
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const { signTypedData } = useSignTypedData();
  const embedded = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];
  const wallet = embedded?.address as Address | undefined;
  const dash = useWalletDashboard(api, wallet);
  const [rootRow] = nameRows(dash.data, config.instances);
  const me = rootRow?.live ? rootRow.ensName.split(".")[0] : undefined;
  const invited = useInvites(api, me);
  const [sent, setSent] = useState<{ account: string; platform: string; text: string }>();
  const [inviteError, setInviteError] = useState<string>();
  const [inviting, setInviting] = useState(false);
  const policyLabel =
    note.trim() || POLICY_PRESETS.find((p) => p.id === named)?.label || named || "reference";

  const invite = async (platform: string, account: string) => {
    setInviteError(undefined);
    if (!authenticated) {
      login();
      return;
    }
    if (!me || !rootRow || !wallet) {
      setInviteError("Hold a name here first: the invitation says who is asking, and that has to be you.");
      return;
    }
    setInviting(true);
    try {
      const message = {
        inviter: me,
        platform,
        account,
        policy: query,
        exp: BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400),
      };
      const { signature } = await signTypedData(
        policyInviteTypedData(message, config.chainId, config.multipass as Address) as never,
        { address: wallet }
      );
      const { code } = await api.storeInvite({
        kind: "policy",
        ...message,
        exp: message.exp.toString(),
        signature,
      });
      // Named by their handle here, the person has a page already: nothing to connect, the page to read.
      const root = config.instances[0];
      const pageName = platform === root.domain ? `${account}.${root.parentName}` : undefined;
      setSent({
        account,
        platform,
        text: policyInviteText(
          rootRow.ensName,
          policyLabel,
          platform,
          account,
          policyInviteLink(site, code),
          pageName
        ),
      });
      void invited.refetch();
    } catch (e) {
      setInviteError((e as Error).message);
    } finally {
      setInviting(false);
    }
  };

  return (
    <>
      <section className="card" data-testid="employer-policy">
        <h2>1 · What you require</h2>
        {/* Found by typing, not by scanning buttons: the presets and the reader's own saved policies. */}
        <div className="searchbar-row">
          <input
            list="employer-policy-names"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                choose(pick);
              }
            }}
            placeholder="hiring, landlord, your own…"
            aria-label="find a policy"
            data-testid="employer-policy-pick"
          />
          <datalist id="employer-policy-names">
            {[...POLICY_PRESETS.map((p) => p.label), ...mine.map((m) => m.name)].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <button type="button" onClick={() => choose(pick)} data-testid="employer-policy-apply">
            Use
          </button>
        </div>
        <p className="row">
          {POLICY_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={named === p.id ? "primary" : ""}
              onClick={() => {
                setPolicy(presetPolicy(p, subjectDomains));
                setNamed(p.id);
              }}
              data-testid={`employer-preset-${p.id}`}
            >
              {p.label}
            </button>
          ))}
          {mine.map((m) => (
            <button
              key={m.name}
              type="button"
              className={named === m.name ? "primary" : ""}
              onClick={() => {
                setPolicy(m.policy);
                setNamed(undefined);
              }}
              data-testid={`employer-mine-${m.name}`}
            >
              {m.name}
            </button>
          ))}
        </p>
        <p className="muted" data-testid="employer-bar">
          {describePolicy(policy)}
        </p>
        <p>
          <button className="linkish" onClick={() => setBuilding((b) => !b)} data-testid="employer-build">
            {building ? "Hide the builder" : "Build your own"}
          </button>
        </p>
        {building && (
          <PolicyForm
            handle=""
            subjectDomains={subjectDomains}
            onApply={(p) => {
              setPolicy(p);
              setNamed(undefined);
              setBuilding(false);
              setMine(loadPolicies());
            }}
          />
        )}
      </section>

      <section className="card" data-testid="employer-add">
        <h2>2 · Who you are considering</h2>
        <label>
          What this is for
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Backend engineer, Q4"
            aria-label="what this is for"
            data-testid="employer-note"
          />
          <small className="muted">Said in the message you send them; never published.</small>
        </label>
        <PersonSearch
          api={api}
          action="Add to the list"
          label="Their name or handle"
          onPick={(h) => {
            setList(shortlist(h, note));
            // The list is the next card down — on a phone, off the screen. Bring it up so adding
            // somebody visibly did something; the row itself also says so.
            document
              .getElementById("employer-report")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          onInvite={(platform, account) => void invite(platform, account)}
          chosen={(h) => list.some((s) => s.handle === h)}
        />
        {inviting && <p className="muted">signing the invitation…</p>}
        {inviteError && (
          <p className="error" role="alert" data-testid="invite-error">
            {inviteError}
          </p>
        )}
        {sent && (
          <p className="card" data-testid="invite-sent">
            <span>
              Send this to <code>@{sent.account}</code> on <code>{sent.platform}</code>:
            </span>
            <br />
            <code data-testid="invite-text">{sent.text}</code>
            <br />
            <CopyButton text={sent.text} label="Copy the invitation" />
          </p>
        )}
        {ready && !authenticated && (
          <p className="muted" data-testid="invite-signin">
            To invite somebody who has no page yet, sign in with a name you hold: the invitation says who is
            asking.
          </p>
        )}
      </section>

      {me && (
        <section className="card" data-testid="employer-invited">
          <h2>Whom you invited</h2>
          {invited.isPending ? (
            <p className="muted">reading…</p>
          ) : !invited.data || invited.data.asked.length === 0 ? (
            <p className="muted" data-testid="invited-none">
              Nobody yet. Search for somebody by their account above; when nobody holds a name for it, you can
              invite them to make one and be read against the bar.
            </p>
          ) : (
            <ul className="acct" data-testid="invited-list">
              {invited.data.asked.map((i) => (
                <li key={i.code} data-testid={`invited-${i.account}`}>
                  <span className="acct-id">
                    <strong>
                      @{i.account} <small className="muted">on {i.platform}</small>
                    </strong>
                    <small className="muted" data-testid={`invited-status-${i.account}`}>
                      {policyInviteStatusText(i.status, i.expired)}
                    </small>
                  </span>
                  <span className="acct-state">
                    {i.candidate ? (
                      <Link className="button" href={`/p/${i.candidate}?${i.policy}`}>
                        Read {i.candidate}
                      </Link>
                    ) : (
                      <CopyButton
                        text={policyInviteText(
                          i.inviterName,
                          policyLabel,
                          i.platform,
                          i.account,
                          policyInviteLink(site, i.code),
                          i.platform === config.instances[0].domain
                            ? `${i.account}.${config.instances[0].parentName}`
                            : undefined
                        )}
                        label="Copy the invitation"
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card" id="employer-report" data-testid="employer-report">
        <h2>Your checks</h2>
        {list.length === 0 ? (
          <p className="muted">
            Nobody on the list yet. Add somebody above and this reads their records against the bar.
          </p>
        ) : (
          <ul className="acct" data-testid="standings">
            {list.map((s) => (
              <Standing
                key={s.handle}
                entry={s}
                policy={policy}
                query={query}
                onInvite={() => void invite(config.instances[0].domain, s.handle)}
                subjectDomains={subjectDomains}
                onDrop={() => setList(unshortlist(s.handle))}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** One candidate, read against the bar — the same reading their own page gives, in one row. */
function Standing({
  entry,
  policy,
  query,
  onInvite,
  subjectDomains,
  onDrop,
}: {
  entry: Shortlisted;
  policy: Policy;
  query: string;
  /** Invite them to pass the bar: signed by the employer, kept under a code, worded for the person */
  onInvite: () => void;
  subjectDomains: string[];
  onDrop: () => void;
}) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const read = useProfile(api, entry.handle);
  /*
   * The shape beside the count, per row.
   * A shortlist is where people are compared, and three references from a team and three from a ring
   * are the same count in every row. What the map says on one page is said here in a phrase.
   */
  const shape = useGraph(api, entry.handle);
  // How their references read, in the row: a list is where people are compared, and three references
  // that read as warnings and three that read as praise are the same count in every row.
  const readings = useReadings(api, entry.handle);
  const readLine = readings.data?.council ? readings.data.summary.received : undefined;
  const names = [config.instances[0], ...config.instances.slice(1)].map(
    (i) => `${entry.handle}.${i.parentName}`
  );
  const profile = read.data
    ? assessProfile(
        entry.handle,
        names.map((name, i) => ({
          instanceDomain: config.instances[i].domain,
          name,
          v: read.data?.names.find((n) => n.name === name)?.verification ?? null,
        })),
        policy,
        read.data.vouches,
        readings.data ? { council: readings.data.council, ...readings.data.summary.received } : undefined
      )
    : undefined;
  const failed = profile?.checks.filter((c) => !c.ok) ?? [];

  return (
    <li data-testid={`standing-${entry.handle}`}>
      <span className="acct-id">
        <strong>{entry.handle}</strong>
        <small className="muted">
          {read.isPending ? (
            "reading…"
          ) : read.isError ? (
            "could not be read just now"
          ) : profile?.complete ? (
            "meets the bar"
          ) : (
            // What is missing, rather than a word: an employer's next step is asking for that thing.
            <>short: {failed.map((c) => c.label).join(", ")}</>
          )}
        </small>
        {shape.data && shape.data.edges.some((e) => e.to === entry.handle) && (
          <small className="muted" data-testid={`shape-${entry.handle}`}>
            {shape.data.metrics.referrersReferringEachOther} of{" "}
            {shape.data.edges.filter((e) => e.to === entry.handle).length} referrers know each other ·
            SybilScore {shape.data.score}
            {shape.data.human && (
              <>
                {" "}
                · <HumanMark />
              </>
            )}
            {(read.data?.standing.withdrawn ?? 0) > 0 && (
              <> · has taken back {read.data!.standing.withdrawn}</>
            )}
          </small>
        )}
        {readLine && readLine.read > 0 && (
          <small className="muted" data-testid={`read-${entry.handle}`}>
            {readLine.supportive} of {readLine.read} read as supportive · {readLine.critical} critical
            {readLine.of > readLine.read && <> · {readLine.of - readLine.read} unread</>}
          </small>
        )}
      </span>
      <span className="acct-state">
        {profile && (
          <span className={`badge ${profile.complete ? "ok" : "off"}`} data-testid={`met-${entry.handle}`}>
            {profile.complete ? "✓" : `${profile.checks.length - failed.length}/${profile.checks.length}`}
          </span>
        )}
        <Link className="button" href={`/p/${entry.handle}?${query}`}>
          Read
        </Link>
        <button type="button" onClick={onInvite} data-testid={`invite-${entry.handle}`}>
          Invite to pass the bar
        </button>
        <button className="linkish" onClick={onDrop} aria-label={`remove ${entry.handle}`}>
          ×
        </button>
      </span>
    </li>
  );
}
