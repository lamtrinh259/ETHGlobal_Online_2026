"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Reading, Verification } from "@/lib/api";
import { apiFor, useReadings } from "@/lib/hooks";
import { useWebConfig } from "@/app/providers";
import { Switch } from "@/app/Switch";
import { ReferencesGiven } from "./ReferencesGiven";
import { VouchList } from "./VouchList";

/**
 * The two halves of somebody's standing, one at a time.
 *
 * What others said about them and what they said about others are different questions, and stacking
 * both made the page long enough that the second was rarely reached. Received is first because it is
 * what a reader came for; given is how that reader judges the people speaking.
 *
 * Each entry carries how it reads — the fast council's provisional polarity, three kinds — beside the
 * words, and the received list can be narrowed to what the person asked for. Both are the reader's
 * tools, not verdicts: the words stay, and unsolicited stays a fact about how a reference arrived.
 */
export function ReferenceTabs({
  handle,
  vouches,
  references,
  standing,
}: {
  handle: string;
  vouches: Parameters<typeof VouchList>[0]["vouches"];
  /** Absent when nobody holds the name: there is no wallet to have written anything from */
  references?: Verification["references"];
  /** Their record as a writer: what stands, and what they have taken back */
  standing?: { given: number; withdrawn: number };
}) {
  const [tab, setTab] = useState<"received" | "given">("received");
  const [onlyAsked, setOnlyAsked] = useState(false);
  const given = references ?? [];
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const readings = useReadings(api, handle);
  const { received, gave } = useMemo(() => {
    const r = readings.data;
    if (!r || !r.council) return { received: undefined, gave: undefined };
    return {
      received: Object.fromEntries(r.received.map((x) => [x.voucher, x.reading])) as Record<
        string,
        Reading | null
      >,
      gave: Object.fromEntries(r.given.map((x) => [x.candidate, x.reading])) as Record<
        string,
        Reading | null
      >,
    };
  }, [readings.data]);
  const unsolicited = vouches.filter((v) => !v.solicited).length;
  const shown = onlyAsked ? vouches.filter((v) => v.solicited) : vouches;

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
          {/* Narrowing to what they asked for is the reader's choice, made in the open: the count says
              how many are set aside, and the ones set aside are still one switch away. */}
          {unsolicited > 0 && (
            <div data-testid="only-asked">
              <Switch
                checked={onlyAsked}
                onChange={setOnlyAsked}
                label="Only references they asked for"
                hint={`${unsolicited} arrived without an invitation${onlyAsked ? ", set aside" : ""}`}
              />
            </div>
          )}
          <VouchList vouches={shown} handle={handle} readings={received} />
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
          {/*
            The rating of references given.
            What somebody has said about others is weighed by whether they stand by it. A reference
            taken back stays on chain, which is the point of withdrawal — and so a record of many
            withdrawals is worth a reader knowing before they weigh the ones that remain.
          */}
          {standing && (standing.given > 0 || standing.withdrawn > 0) && (
            <p className="muted" data-testid="given-record">
              {standing.given} standing
              {standing.withdrawn > 0 ? ` · ${standing.withdrawn} taken back` : " · none taken back"}
            </p>
          )}
          {given.length ? (
            <ReferencesGiven references={given} readings={gave} />
          ) : (
            <p className="muted" data-testid="none-given">
              {handle} has not written a reference for anybody here.
            </p>
          )}
          {/* Asking them for one: an invitation is made on your own page and sent to them. */}
          <p className="row">
            <Link className="button" href="/me#invite" data-testid="request-reference">
              Request a reference from {handle}
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
