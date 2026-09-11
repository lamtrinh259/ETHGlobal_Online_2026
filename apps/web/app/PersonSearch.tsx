"use client";

import { useState } from "react";
import type { Api } from "@/lib/api";
import Link from "next/link";
import { PlatformPicker } from "@/app/PlatformPicker";
import { CopyButton } from "@/app/CopyButton";
import { useFind, useWho } from "@/lib/hooks";
import { ADDRESS_RE } from "@/lib/profile";

/** The platforms a reader is likely to know somebody by, offered beside the search. */
const PLATFORMS = ["x.com", "github.com", "google.com", "discord.com", "linkedin.com", "t.me"];

const refs = (s: { received: number }) => `${s.received} reference${s.received === 1 ? "" : "s"} received`;

/** What to send somebody whose account is here but whose name nobody holds. */
export function claimAsk(platform: string, handle: string, site: string): string {
  return (
    `I looked you up on Ketsuban and nobody holds a name for you yet. If you link your ${platform} ` +
    `account (@${handle}) there, references written for you attach to it and the page is yours: ${site}/me`
  );
}

/**
 * Finding the person you mean.
 *
 * Two ways in, because they answer different questions. An account identifies somebody exactly — one
 * handle on one platform is one person — while a name does not: two people really are called `bob`.
 * The name path does not pretend otherwise. It lists everyone of that name with the references each
 * has received and lets the reader decide, because nothing on chain settles which `bob` is meant and
 * the one people have actually vouched for is the one they mean. That answer gets truer over time
 * instead of being fixed by whoever registered first.
 *
 * Shared by every page that has to find a person — check a candidate, write a reference, refer
 * someone — because they were three different inputs for one question, and only one of them could
 * search at all.
 */
export function PersonSearch({
  api,
  onPick,
  action,
  autoFocus,
  label,
  onAddress,
  pinned = [],
  big = false,
}: {
  api: Api;
  onPick: (handle: string) => void;
  /** What picking somebody does here, said in the button */
  action: string;
  autoFocus?: boolean;
  /** What the field is called here; the front page asks a broader question than a verifier does */
  label?: string;
  /** Where a wallet address goes, for callers that can show one */
  onAddress?: (address: string) => void;
  /**
   * Kept at the top of the list, above whatever was found.
   *
   * A subject is not a person and never appears in a search for one, but it is the thing most readers
   * here have actually come to look at. Ranking cannot put it first because it is not in the ranking.
   */
  pinned?: { href: string; label: string; note?: string }[];
  /** The front page is this box, so there it is the size of the thing people came to do */
  big?: boolean;
}) {
  const [byAccount, setByAccount] = useState(false);
  const [platform, setPlatform] = useState("x.com");
  const [account, setAccount] = useState("");
  const [hasCode, setHasCode] = useState(false);
  const [viewCode, setViewCode] = useState("");
  const [query, setQuery] = useState("");
  const site = typeof window === "undefined" ? "" : window.location.origin;

  const who = useWho(api, platform, account, hasCode ? viewCode.trim() : undefined);
  const found = useFind(api, query);
  const clean = query.trim().toLowerCase().replace(/^@/, "");
  // A wallet address is the other thing a verifier arrives holding — from a transaction, a signature
  // or a CV. It is the same question, so it is the same field.
  const address = ADDRESS_RE.test(query.trim()) ? query.trim() : undefined;
  const exact = /^[a-z0-9-]{1,31}$/.test(clean);
  const matches = found.data?.matches ?? [];
  const named = matches.some((m) => m.handle === clean);

  return (
    <div data-testid="person-search">
      {/*
        One field, because there was one question. The two buttons asked the reader to classify what
        they knew before typing it, and the second field only ever answered the rarer half.
      */}
      {!byAccount ? (
        <>
          <label className={big ? "search-big" : undefined}>
            {label ?? "Their name or handle"}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="bob"
              aria-label="their name"
              autoFocus={autoFocus}
              data-testid="name-query"
            />
          </label>

          {address && onAddress && (
            <p className="muted" data-testid="is-address">
              That is a wallet address.{" "}
              <button className="linkish" onClick={() => onAddress(address)} data-testid="open-wallet">
                See everything it holds →
              </button>
            </p>
          )}

          {!address && found.isFetching && <p className="muted">looking…</p>}

          {pinned.length > 0 && (
            <ul className="acct" data-testid="pinned">
              {pinned.map((x) => (
                <li key={x.href}>
                  <span className="acct-id">
                    <strong>{x.label}</strong>
                    {x.note && <small className="muted">{x.note}</small>}
                  </span>
                  <span className="acct-state">
                    <Link className="button" href={x.href}>
                      {action}
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {matches.length > 0 && (
            <>
              <p className="muted">
                {clean
                  ? "Most referenced first — the only evidence of which one people mean."
                  : "Most referenced first."}
              </p>
              <ul className="acct" data-testid="matches">
                {matches.map((m) => (
                  <li key={m.handle} data-testid={`match-${m.handle}`}>
                    <span className="acct-id">
                      <strong>{m.handle}</strong>
                      <small className="muted">
                        {refs(m)}
                        {m.claimed ? "" : " · unclaimed"}
                      </small>
                    </span>
                    <span className="acct-state">
                      <button onClick={() => onPick(m.handle)} data-testid={`pick-${m.handle}`}>
                        {action}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/*
            Nobody holding a name is not a dead end — a page can be made for somebody who has claimed
            nothing, which is how a person is referred before they have heard of any of this. But it
            makes a different kind of page, and that is worth knowing before it is made: nothing on it
            is tied to a real account until whoever it is about signs in and links one. Until then it
            is a page about a name, the way the subjects here are.
          */}
          {clean.length >= 2 && !found.isFetching && exact && !named && (
            <div className="muted" data-testid="no-match">
              <p>
                Nobody holds <strong>{clean}</strong> yet. Opening it makes a page about the name: people can
                write references there, and none of it can be linked to a real account until whoever it is
                about claims it.
              </p>
              <p className="row">
                <button className="linkish" onClick={() => onPick(clean)} data-testid="use-anyway">
                  {action} anyway →
                </button>
                <button className="linkish" onClick={() => setByAccount(true)} data-testid="rather-account">
                  I know an account of theirs instead
                </button>
              </p>
            </div>
          )}
          {/* What kind of thing was typed. A name is the common case and stays the default; naming a
              platform says the box holds an account there instead. */}
          <label className="search-kind">
            searching for{" "}
            <select
              value="name"
              onChange={(e) => {
                setPlatform(e.target.value);
                setByAccount(true);
              }}
              aria-label="what you are searching for"
              data-testid="by-account"
            >
              <option value="name">a name</option>
              {PLATFORMS.map((d) => (
                <option key={d} value={d}>
                  an account on {d}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : (
        <>
          <p>
            <button className="linkish" onClick={() => setByAccount(false)} data-testid="by-name">
              ← Search by name instead
            </button>
          </p>
          <PlatformPicker single selected={[platform]} onToggle={setPlatform} />
          <label>
            Their handle on <code>{platform}</code>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="@bob"
              aria-label="their account"
              data-testid="account-handle"
            />
          </label>

          {/* A private account is a one-time pad on chain, so nothing can search it. The view code is
              the exception, and it is one the person chose to hand over. */}
          {!hasCode ? (
            <p>
              <button className="linkish" onClick={() => setHasCode(true)} data-testid="have-viewcode">
                They gave me a view code
              </button>
            </p>
          ) : (
            <label>
              Their view code
              <input
                value={viewCode}
                onChange={(e) => setViewCode(e.target.value)}
                placeholder="0x…"
                aria-label="view code"
                data-testid="viewcode"
              />
              <small className="muted">A private account is unsearchable without it.</small>
            </label>
          )}

          <p className="muted" data-testid="who-result">
            {account.trim().length < 2 ? (
              "An account identifies them exactly; a name does not."
            ) : who.isFetching ? (
              "looking…"
            ) : who.data?.found && who.data.candidate ? (
              <>
                That is <strong>{who.data.candidate}</strong>
                {who.data.standing ? <> · {refs(who.data.standing)}</> : null}.{" "}
                <button className="linkish" onClick={() => onPick(who.data!.candidate!)} data-testid="who-go">
                  {action} →
                </button>
              </>
            ) : who.data?.note ? (
              who.data.note
            ) : (
              <>Nobody has attested that account here.</>
            )}
          </p>

          {/*
            An account nobody attested is the one case where the person can be reached: whoever holds
            `@bob` on that platform can sign in, link it, and the page becomes theirs. So this offers
            something to send them rather than a dead end.
          */}
          {account.trim().length >= 2 && !who.isFetching && !who.data?.found && (
            <p className="row" data-testid="invite-to-claim">
              <CopyButton
                text={claimAsk(platform, account.trim().replace(/^@/, ""), site)}
                label="Copy an ask they can act on"
              />
              <small className="muted">
                They sign in, link <code>{platform}</code>, and the name is theirs.
              </small>
            </p>
          )}
        </>
      )}
    </div>
  );
}
