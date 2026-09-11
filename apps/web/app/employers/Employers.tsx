"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/app/CopyButton";
import { PolicyForm } from "@/app/PolicyForm";
import { PersonSearch } from "@/app/PersonSearch";
import { useWebConfig } from "@/app/providers";
import { apiFor, useProfile } from "@/lib/hooks";
import { loadPolicies, type SavedPolicy } from "@/lib/policies";
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
  useEffect(() => {
    setMine(loadPolicies());
    setList(loadShortlist());
  }, []);

  const site = typeof window === "undefined" ? "" : window.location.origin;
  const query = policyToQuery(policy, named);
  const askFor = (handle: string) =>
    `I am checking references for ${note.trim() || "a role"}. Here is the bar: ${describePolicy(policy)}. ` +
    `Your page, read against it: ${site}/p/${handle}?${query}`;

  return (
    <>
      <section className="card" data-testid="employer-policy">
        <h2>1 · What you require</h2>
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
          onPick={(h) => setList(shortlist(h, note))}
        />
      </section>

      <section className="card" data-testid="employer-report">
        <h2>3 · Where each of them stands</h2>
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
                ask={askFor(s.handle)}
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
  ask,
  subjectDomains,
  onDrop,
}: {
  entry: Shortlisted;
  policy: Policy;
  query: string;
  ask: string;
  subjectDomains: string[];
  onDrop: () => void;
}) {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const read = useProfile(api, entry.handle);
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
        read.data.vouches
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
        <CopyButton text={ask} label="Copy the ask" />
        <button className="linkish" onClick={onDrop} aria-label={`remove ${entry.handle}`}>
          ×
        </button>
      </span>
    </li>
  );
}
