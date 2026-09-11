"use client";

import Link from "next/link";
import { useState } from "react";
import type { Verification } from "@/lib/api";
import { ReferencesGiven } from "./ReferencesGiven";
import { VouchList } from "./VouchList";

/**
 * The two halves of somebody's standing, one at a time.
 *
 * What others said about them and what they said about others are different questions, and stacking
 * both made the page long enough that the second was rarely reached. Received is first because it is
 * what a reader came for; given is how that reader judges the people speaking.
 */
export function ReferenceTabs({
  handle,
  vouches,
  references,
}: {
  handle: string;
  vouches: Parameters<typeof VouchList>[0]["vouches"];
  /** Absent when nobody holds the name: there is no wallet to have written anything from */
  references?: Verification["references"];
}) {
  const [tab, setTab] = useState<"received" | "given">("received");
  const given = references ?? [];

  return (
    <>
      <div className="row" role="tablist" aria-label="references" data-testid="reference-tabs">
        <button
          role="tab"
          aria-selected={tab === "received"}
          className={tab === "received" ? "primary" : ""}
          onClick={() => setTab("received")}
          data-testid="tab-received"
        >
          Received ({vouches.length})
        </button>
        <button
          role="tab"
          aria-selected={tab === "given"}
          className={tab === "given" ? "primary" : ""}
          onClick={() => setTab("given")}
          data-testid="tab-given"
        >
          Given ({given.length})
        </button>
      </div>

      {tab === "received" ? (
        <div role="tabpanel" aria-label="references received">
          <VouchList vouches={vouches} handle={handle} />
          {/* A reader who has just read what people say about somebody is the likeliest person to add
              to it. This lived on the other route, and a person's page had no way to reach it. */}
          <p className="row">
            <Link className="button primary" href={`/vouch/${handle}`}>
              Refer this person
            </Link>
          </p>
        </div>
      ) : (
        <div role="tabpanel" aria-label="references given">
          {given.length ? (
            <ReferencesGiven references={given} />
          ) : (
            <p className="muted" data-testid="none-given">
              {handle} has not written a reference for anybody here.
            </p>
          )}
        </div>
      )}
    </>
  );
}
