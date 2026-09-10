"use client";

import { useState } from "react";
import type { Api } from "@/lib/api";
import { Modal } from "@/app/Modal";
import { PlatformPicker } from "@/app/PlatformPicker";
import type { Ask } from "@/lib/asks";
import { useFind, useWho } from "@/lib/hooks";

const label = (s: { received: number }) => `${s.received} reference${s.received === 1 ? "" : "s"} received`;

/**
 * Refer anyone. Two ways in, because they answer different questions: you either know an account they
 * hold, which identifies them exactly, or you only know a name, which does not.
 *
 * The name path cannot be made exact — two people really are called `bob` — so it does not try. It
 * shows everyone of that name with the references each has received and lets the person referring
 * decide. Nothing on chain settles which `bob` is meant, and the one people have actually vouched for
 * is the one they mean; that answer gets truer over time rather than being fixed by whoever was first.
 */
export function ReferSomeone({ api, onGo }: { api: Api; onGo: (handle: string, ask?: Ask) => void }) {
  const [picking, setPicking] = useState<{ ask?: Ask }>();
  const [how, setHow] = useState<"account" | "name">("account");
  const [platform, setPlatform] = useState<string>("x.com");
  const [account, setAccount] = useState("");
  const [hasCode, setHasCode] = useState(false);
  const [viewCode, setViewCode] = useState("");
  const [query, setQuery] = useState("");

  const dns = platform;
  const who = useWho(api, dns, account, hasCode ? viewCode.trim() : undefined);
  const found = useFind(api, query);
  const clean = query.trim().toLowerCase().replace(/^@/, "");
  /** Opening with an ask in hand keeps the choice: nobody should be asked the same thing twice. */
  const open = (ask?: Ask) => setPicking({ ask });
  const canStart = /^[a-z0-9-]{1,31}$/.test(clean);

  return (
    <div data-testid="refer-someone">
      <p className="muted">Anyone can refer anyone. No permission needed, no account needed.</p>

      <p>
        <button className="primary" onClick={() => open()} data-testid="refer-open">
          Refer someone
        </button>
      </p>

      {picking && (
        <Modal
          title={picking.ask ? picking.ask.label : "Refer someone"}
          onClose={() => setPicking(undefined)}
        >
          <div data-testid="refer-dialog">
            {picking.ask && (
              <p className="muted">
                Writing: <strong>{picking.ask.label}</strong>
              </p>
            )}
            <p className="row" role="group" aria-label="how you know them">
              <button
                className={how === "account" ? "primary" : ""}
                onClick={() => setHow("account")}
                data-testid="by-account"
              >
                I know an account of theirs
              </button>
              <button
                className={how === "name" ? "primary" : ""}
                onClick={() => setHow("name")}
                data-testid="by-name"
              >
                I only know their name
              </button>
            </p>

            {how === "account" && (
              <>
                <PlatformPicker single selected={[dns]} onToggle={(d) => setPlatform(d)} />
                <label>
                  Their handle on <code>{dns}</code>
                  <input
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="@bob"
                    aria-label="their account"
                    data-testid="account-handle"
                  />
                </label>
                {/* A private account is a one-time pad on chain, so nothing can search it. The view code is
                    the exception, and it is one the candidate chose to hand over. */}
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
                      {who.data.standing ? <> · {label(who.data.standing)}</> : null}.{" "}
                      <button
                        className="linkish"
                        onClick={() => onGo(who.data!.candidate as string, picking?.ask)}
                        data-testid="who-go"
                      >
                        Write their reference →
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

            {how === "name" && (
              <>
                <label>
                  Their name or handle
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="bob"
                    aria-label="their name"
                    data-testid="name-query"
                  />
                </label>

                {found.data && found.data.matches.length > 0 && (
                  <>
                    <p className="muted">
                      Most referenced first — the only evidence of which one people mean.
                    </p>
                    <ul className="acct" data-testid="matches">
                      {found.data.matches.map((m) => (
                        <li key={m.handle} data-testid={`match-${m.handle}`}>
                          <span className="acct-id">
                            <strong>{m.handle}</strong>
                            <small className="muted">
                              {label(m)}
                              {m.claimed ? "" : " · unclaimed"}
                            </small>
                          </span>
                          <span className="acct-state">
                            <button
                              onClick={() => onGo(m.handle, picking?.ask)}
                              data-testid={`pick-${m.handle}`}
                            >
                              Refer this one
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* Offered after the search has answered: starting a second page for someone already here
                    splits their references in two, and nobody can put them back together. */}
                {canStart && found.data && (
                  <p className="row">
                    <button
                      className="primary"
                      onClick={() => onGo(clean, picking?.ask)}
                      data-testid="refer-new"
                    >
                      {found.data.matches.length ? `None of these — refer ${clean}` : `Refer ${clean}`}
                    </button>
                  </p>
                )}
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
