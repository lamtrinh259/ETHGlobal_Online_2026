"use client";

import { useState } from "react";
import type { Api } from "@/lib/api";
import { PlatformPicker } from "@/app/PlatformPicker";
import { useFind, useWho } from "@/lib/hooks";

const refs = (s: { received: number }) => `${s.received} reference${s.received === 1 ? "" : "s"} received`;

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
}: {
  api: Api;
  onPick: (handle: string) => void;
  /** What picking somebody does here, said in the button */
  action: string;
  autoFocus?: boolean;
}) {
  const [how, setHow] = useState<"name" | "account">("name");
  const [platform, setPlatform] = useState("x.com");
  const [account, setAccount] = useState("");
  const [hasCode, setHasCode] = useState(false);
  const [viewCode, setViewCode] = useState("");
  const [query, setQuery] = useState("");

  const who = useWho(api, platform, account, hasCode ? viewCode.trim() : undefined);
  const found = useFind(api, query);
  const clean = query.trim().toLowerCase().replace(/^@/, "");
  const exact = /^[a-z0-9-]{1,31}$/.test(clean);
  const matches = found.data?.matches ?? [];
  const named = matches.some((m) => m.handle === clean);

  return (
    <div data-testid="person-search">
      <p className="row" role="group" aria-label="how you know them">
        <button
          className={how === "name" ? "primary" : ""}
          onClick={() => setHow("name")}
          data-testid="by-name"
        >
          By name
        </button>
        <button
          className={how === "account" ? "primary" : ""}
          onClick={() => setHow("account")}
          data-testid="by-account"
        >
          By an account of theirs
        </button>
      </p>

      {how === "name" ? (
        <>
          <label>
            Their name or handle
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="bob"
              aria-label="their name"
              autoFocus={autoFocus}
              data-testid="name-query"
            />
          </label>

          {clean.length >= 2 && found.isFetching && <p className="muted">looking…</p>}

          {matches.length > 0 && (
            <>
              <p className="muted">Most referenced first — the only evidence of which one people mean.</p>
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

          {/* Nobody holding a name is not a dead end: a page can be made for somebody who has claimed
              nothing, and that is how a person is referred before they have heard of any of this. */}
          {clean.length >= 2 && !found.isFetching && exact && !named && (
            <p className="muted" data-testid="no-match">
              Nobody holds <strong>{clean}</strong> yet.{" "}
              <button className="linkish" onClick={() => onPick(clean)} data-testid="use-anyway">
                {action} anyway →
              </button>
            </p>
          )}
        </>
      ) : (
        <>
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
              <>Nobody holds that account here. Try their name instead.</>
            )}
          </p>
        </>
      )}
    </div>
  );
}
