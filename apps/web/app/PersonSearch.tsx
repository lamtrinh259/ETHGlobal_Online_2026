"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Api } from "@/lib/api";
import Link from "next/link";
import { CopyButton } from "@/app/CopyButton";
import { useContracts, useFind, useWho } from "@/lib/hooks";
import { ADDRESS_RE } from "@/lib/profile";

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
  also,
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
  /**
   * A second thing to do with whoever was found.
   *
   * Checking somebody and writing about them are the same lookup and were two pages of it. Offered
   * on the result, a reader picks the person once and then says which of the two they came for.
   */
  also?: { label: string; onPick: (handle: string) => void };
}) {
  /*
   * What this deployment answers for, rather than a list kept here.
   *
   * A domain with a dot is a DNS name — a platform or a mail host — which is exactly what somebody
   * can be known by. The rest are this deployment's own name domains and the per-candidate vouch
   * instances, and nobody has an account at either.
   */
  const contracts = useContracts(api);
  const domains = (contracts.data?.instances ?? []).map((i) => i.domain).filter((d) => d.includes("."));
  // Empty means a name, which is what the box says when nothing has been typed into it.
  const [platform, setPlatform] = useState("");
  const [hasCode, setHasCode] = useState(false);
  const [viewCode, setViewCode] = useState("");
  const [query, setQuery] = useState("");
  const site = typeof window === "undefined" ? "" : window.location.origin;
  const router = useRouter();

  // The one box: a name when no domain is named beside it, that domain's handle when one is.
  const account = platform ? query : "";
  const who = useWho(api, platform, account, hasCode ? viewCode.trim() : undefined);
  const found = useFind(api, query);
  const clean = query.trim().toLowerCase().replace(/^@/, "");
  // A wallet address is the other thing a verifier arrives holding — from a transaction, a signature
  // or a CV. It is the same question, so it is the same field.
  const address = ADDRESS_RE.test(query.trim()) ? query.trim() : undefined;
  const exact = /^[a-z0-9-]{1,31}$/.test(clean);
  const matches = found.data?.matches ?? [];
  const named = matches.some((m) => m.handle === clean);

  /*
   * The suggestions, reachable from the keyboard.
   *
   * A search box people type into is a box they expect to arrow down out of. Every option was a
   * button, so the only way to reach the third one was to tab past the two above it and whatever
   * else each row contained — and the pinned subject, the thing most readers came for, sat behind
   * all of them.
   */
  /*
   * A pinned row is still a row in the list, so it answers to what was typed.
   *
   * Left in regardless it was the first thing under "most referenced first" for every search, and
   * arrowing down to the first suggestion opened the subject rather than the person being looked for.
   */
  const shownPinned = pinned.filter(
    (x) => !clean || x.label.toLowerCase().includes(clean) || x.href.toLowerCase().includes(clean)
  );

  /*
   * Only what is on screen.
   *
   * With a domain named, the list is the one account that domain resolves to and the name matches are
   * hidden — but the search for them still ran, so arrowing or pressing enter reached a row nobody
   * could see and opened somebody the reader had not been shown.
   */
  const options: { key: string; go: () => void }[] = platform
    ? who.data?.found && who.data.candidate
      ? [{ key: "who", go: () => onPick(who.data!.candidate!) }]
      : []
    : [
        ...shownPinned.map((x) => ({ key: `pin:${x.href}`, go: () => router.push(x.href) })),
        ...matches.map((m) => ({ key: `hit:${m.handle}`, go: () => onPick(m.handle) })),
      ];
  const [active, setActive] = useState(-1);
  /*
   * Kept in a ref as well as in state.
   *
   * Arrow-then-enter is one gesture and both keys land before React has re-rendered, so a handler
   * reading the state still saw "nothing selected" and enter did nothing. Typing that fast is what
   * people do with a search box; the ref is what the second key reads.
   */
  const activeRef = useRef(-1);
  // Naming a domain is done in the bar, so anything offering that sends focus there.
  const kindBox = useRef<HTMLInputElement>(null);
  const at = active >= 0 && active < options.length ? active : -1;
  const move = (n: number) => {
    activeRef.current = n;
    setActive(n);
  };

  function onKeyDown(e: React.KeyboardEvent) {
    /*
     * Enter is how somebody finishes typing a name.
     *
     * Everywhere else they have typed one, enter acts on it; here it did nothing unless they had
     * arrowed down first, so the name of somebody visible on screen went nowhere. With nothing
     * selected it takes the top of the ranking — and where the ranking is empty because nobody holds
     * that name, the page that name would make, which is the only thing left to do with it.
     */
    if (!options.length) {
      if (e.key === "Enter" && !platform && !address && exact && !named && !found.isFetching) {
        e.preventDefault();
        onPick(clean);
      }
      return;
    }
    const i = activeRef.current;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      // From nothing, down takes the first and up takes the last, which is where each one points.
      move(i < 0 ? (step > 0 ? 0 : options.length - 1) : (i + step + options.length) % options.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Arrowed to something, that. Otherwise the top of the ranking, which is what the list is for.
      if (i >= 0 && i < options.length) options[i].go();
      else options[0].go();
    } else if (e.key === "Escape") {
      move(-1);
    }
  }

  return (
    <div data-testid="person-search">
      {/*
        One field, because there was one question. The two buttons asked the reader to classify what
        they knew before typing it, and the second field only ever answered the rarer half.
      */}
      <>
        {/*
            One control, not a field with a setting under it.
            What kind of thing is being typed belongs to the box it is typed into — a reader chooses
            it while asking, the way they would in any search bar. Underneath the results it was a
            setting to go and find after the search had already failed to be what they meant.
          */}
        <div className={big ? "searchbar searchbar-big" : "searchbar"} data-testid="searchbar">
          <span className="searchbar-label">{label ?? "Their name or handle"}</span>
          <div className="searchbar-row">
            {/* A row of inputs reads as a form; the magnifier is what makes it read as a search. */}
            <span className="searchbar-icon" aria-hidden>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>
            </span>
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                move(-1);
              }}
              onKeyDown={onKeyDown}
              placeholder={platform ? "their handle" : "a name or a handle"}
              aria-label={platform ? "their account" : "their name"}
              autoFocus={autoFocus}
              role="combobox"
              aria-expanded={options.length > 0}
              aria-controls="search-suggestions"
              aria-activedescendant={at >= 0 ? options[at].key : undefined}
              data-testid="name-query"
            />
            {query && (
              <button
                type="button"
                className="searchbar-clear"
                onClick={() => setQuery("")}
                aria-label="clear"
                data-testid="clear-query"
              >
                ×
              </button>
            )}
            {/*
                Typed, not chosen from a list.
                A deployment mounts a domain the first time somebody attests an account there, so the
                list grows on its own and a menu of it is out of date by definition — and a mail host
                is a domain like any other, which a fixed list of platforms left out entirely. The
                completion is what this deployment actually holds, and anything else is still typable.
              */}
            <input
              ref={kindBox}
              className="searchbar-kind"
              list="search-domains"
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value);
              }}
              placeholder="by name"
              aria-label="what you are searching for"
              data-testid="by-account"
            />
            {/*
              The way back out.
              Naming a domain is one keystroke; unnaming it meant selecting the text and deleting it,
              with nothing on screen saying so. A name is the default, so returning to it is a button.
            */}
            {platform && (
              <button
                type="button"
                className="searchbar-clear searchbar-clear-kind"
                onClick={() => {
                  setPlatform("");
                  setHasCode(false);
                  kindBox.current?.focus();
                }}
                aria-label="search by name instead"
                data-testid="clear-kind"
              >
                ×
              </button>
            )}
            <datalist id="search-domains">
              {domains.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
        </div>

        {address && onAddress && (
          <p className="muted" data-testid="is-address">
            That is a wallet address.{" "}
            <button className="linkish" onClick={() => onAddress(address)} data-testid="open-wallet">
              See everything it holds →
            </button>
          </p>
        )}

        {!platform && !address && found.isFetching && <p className="muted">looking…</p>}

        {/*
            One list, not a block above a list.
            A subject is something people here have written about, so it belongs among the things they
            have written about — read as the first row of the ranking rather than as a banner over it.
          */}
        {!platform && (shownPinned.length > 0 || matches.length > 0) && (
          <>
            <p className="muted">
              {clean
                ? "Most referenced first — the only evidence of which one people mean."
                : "Most referenced first."}
            </p>
            <ul className="acct" id="search-suggestions" data-testid="matches">
              {shownPinned.map((x) => (
                <li
                  key={x.href}
                  id={`pin:${x.href}`}
                  className={options[at]?.key === `pin:${x.href}` ? "here" : undefined}
                  data-testid="pinned"
                >
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
              {matches.map((m) => (
                <li
                  key={m.handle}
                  id={`hit:${m.handle}`}
                  className={options[at]?.key === `hit:${m.handle}` ? "here" : undefined}
                  data-testid={`match-${m.handle}`}
                >
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
                    {also && (
                      <button onClick={() => also.onPick(m.handle)} data-testid={`also-${m.handle}`}>
                        {also.label}
                      </button>
                    )}
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
        {!platform && clean.length >= 2 && !found.isFetching && exact && !named && (
          <div className="muted" data-testid="no-match">
            <p>
              Nobody holds <strong>{clean}</strong> yet. Opening it makes a page about the name: people can
              write references there, and none of it can be linked to a real account until whoever it is about
              claims it.
            </p>
            <p className="row">
              <button className="linkish" onClick={() => onPick(clean)} data-testid="use-anyway">
                {action} anyway →
              </button>
              <button
                className="linkish"
                onClick={() => kindBox.current?.focus()}
                data-testid="rather-account"
              >
                I know an account of theirs instead
              </button>
            </p>
          </div>
        )}

        {platform && (
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
        )}

        {/*
            An account nobody attested is the one case where the person can be reached: whoever holds
            `@bob` on that platform can sign in, link it, and the page becomes theirs. So this offers
            something to send them rather than a dead end.
          */}
        {/* A private account is a one-time pad on chain, so nothing can search it. The view code is
              the exception, and it is one the person chose to hand over. */}
        {platform &&
          (hasCode ? (
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
          ) : (
            <p>
              <button className="linkish" onClick={() => setHasCode(true)} data-testid="have-viewcode">
                They gave me a view code
              </button>
            </p>
          ))}

        {platform && account.trim().length >= 2 && !who.isFetching && !who.data?.found && (
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
    </div>
  );
}
