"use client";

import { useState } from "react";
import { questionTitle } from "@/lib/questions";

/**
 * A reference someone is commonly asked to give. The list exists because a blank box asks a visitor
 * to invent something; these are the asks this deployment actually expects.
 */
export type Ask = { id: string; label: string; placeholder: string };

export const POPULAR_ASKS: Ask[] = [
  {
    id: "kju-is",
    label: questionTitle("kju-is"),
    placeholder: "a terrible dictator",
  },
  {
    id: "worked-together",
    label: "How you worked together",
    placeholder: "CTO at Acme 2019-22",
  },
  {
    id: "know-them",
    label: "How you know them",
    placeholder: "co-founded Acme with them",
  },
];

/**
 * Refer anyone, by handle. No invitation: a reference is a claim its writer signs, and it carries the
 * weight of who they are. One nobody asked for is written all the same and marked unsolicited, which
 * is a note on the reference rather than a barrier to it.
 */
export function ReferSomeone({ onGo }: { onGo: (handle: string, ask?: Ask) => void }) {
  const [handle, setHandle] = useState("");
  const clean = handle.trim().toLowerCase().replace(/^@/, "");
  const ready = /^[a-z0-9-]{1,31}$/.test(clean);

  return (
    <div data-testid="refer-someone">
      <p className="muted">
        Anyone can refer anyone here — you do not need their permission, and they do not need an account yet.
        If they have never claimed their handle, the reference waits for them and attaches when they do. They
        will see that they never asked for it.
      </p>
      <p className="row">
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="their handle, e.g. bob"
          aria-label="who you are referring"
          data-testid="refer-handle"
        />
        <button className="primary" onClick={() => onGo(clean)} disabled={!ready} data-testid="refer-go">
          Write a reference
        </button>
      </p>

      <h3>References people are asked for</h3>
      <ul className="acct" data-testid="popular-asks">
        {POPULAR_ASKS.map((ask) => (
          <li key={ask.id}>
            <span className="acct-id">
              <strong>{ask.label}</strong>
              <small className="muted">“{ask.placeholder}”</small>
            </span>
            <span className="acct-state">
              <button onClick={() => onGo(clean, ask)} disabled={!ready} data-testid={`ask-${ask.id}`}>
                Answer this
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
