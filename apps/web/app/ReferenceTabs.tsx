"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Reading, Verification } from "@/lib/api";
import { apiFor, useReadings } from "@/lib/hooks";
import { useWebConfig } from "@/app/providers";
import { signed } from "@/app/LeanChip";
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
 * How the statements read is here too, rather than in a card of its own further down: the sum at the
 * top of the list, the council's reading beside each statement and its reason under it. Said twice it
 * was the same list read twice, and the second copy was the one a reader had to scroll to. It is a
 * reading of text, not a judgement of a person, and the line at the bottom says so.
 */
function Summary({
  s,
  side,
}: {
  s: { of: number; read: number; mean: number | null; supportive: number; critical: number };
  side: "received" | "given";
}) {
  const unread = s.of - s.read;
  return (
    <p data-testid={`readings-${side}`}>
      <strong>{s.supportive}</strong> of {s.read} read as supportive · <strong>{s.critical}</strong> critical
      {s.mean !== null && (
        <>
          {" "}
          · mean <strong>{signed(s.mean)}</strong>
        </>
      )}
      {unread > 0 && <span className="muted"> · {unread} unread</span>}
    </p>
  );
}

/** Provisional, and by which council: a number beside somebody's name has to say where it came from. */
function Provisional({ model }: { model: string | null }) {
  return (
    <p className="muted">
      <small>provisional — how {model} read each statement, superseded when peers have judged</small>
    </p>
  );
}

/** Nothing read them, so nothing here pretends to have. */
function NoCouncil({ side }: { side: "received" | "given" }) {
  return (
    <p className="muted" data-testid="readings-no-council">
      Shown as written: no council reads statements on this deployment, so {side} references carry the words
      and nothing else.
    </p>
  );
}

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
  const r = readings.data;
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
          {/* The sum of the readings the rows below carry: what a reader gets in the time they have. */}
          {r && vouches.length > 0 && !r.council && <NoCouncil side="received" />}
          {r && r.council && r.received.length > 0 && (
            <>
              <Summary s={r.summary.received} side="received" />
              <Provisional model={r.model} />
            </>
          )}
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
          {r?.council && (
            <p className="muted readings-caveat">
              A reading is how a council of models read thirty-one bytes of text, not a judgement of a person.
              The words are the record; the reading is a way in.{" "}
              <Link href="/trust">How statements are read →</Link>
            </p>
          )}
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
          {r && given.length > 0 && !r.council && <NoCouncil side="given" />}
          {r && r.council && r.given.length > 0 && (
            <>
              <Summary s={r.summary.given} side="given" />
              <Provisional model={r.model} />
            </>
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
