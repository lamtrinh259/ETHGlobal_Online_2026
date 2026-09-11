"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PolicyForm } from "@/app/PolicyForm";
import { loadPolicies, type SavedPolicy } from "@/lib/policies";
import { describePolicy, POLICY_PRESETS, policyToQuery, presetPolicy, type Policy } from "@/lib/profile";

/**
 * Applying a bar to somebody, in one field.
 *
 * A person's page used to arrive already graded against a default nobody chose: a column of ticks
 * saying what the metrics beside it said, under a word — "incomplete" — passing judgement on a person
 * for a bar they were never told about. A verdict is something a reader performs, so it is asked for
 * here: type a policy, or pick one, and the checks are the answer to that question.
 *
 * The presets are what the platform ships. The rest are the reader's own, kept in their browser,
 * because what somebody's bar is is nobody else's business.
 */
export function PolicyBar({
  handle,
  subjectDomains,
  applied,
}: {
  handle: string;
  subjectDomains: string[];
  /** The policy in force, when the reader asked for one */
  applied?: Policy;
}) {
  const router = useRouter();
  const [mine, setMine] = useState<SavedPolicy[]>([]);
  const [pick, setPick] = useState("");
  const [building, setBuilding] = useState(false);
  // Read after mount: storage belongs to the browser, and the server has none to render from.
  useEffect(() => setMine(loadPolicies()), []);

  const named = (name: string): Policy | undefined => {
    const key = name.trim().toLowerCase();
    const preset = POLICY_PRESETS.find((p) => p.label.toLowerCase() === key || p.id === key);
    if (preset) return presetPolicy(preset, subjectDomains);
    return mine.find((m) => m.name.toLowerCase() === key)?.policy;
  };

  function apply(name: string) {
    const policy = named(name);
    if (!policy) return;
    const preset = POLICY_PRESETS.find((p) => p.label.toLowerCase() === name.trim().toLowerCase());
    router.push(`/p/${handle}?${policyToQuery(policy, preset?.id)}`);
  }

  const options = [...POLICY_PRESETS.map((p) => p.label), ...mine.map((m) => m.name)];

  return (
    <section className="card" data-testid="policy-bar">
      <div className="searchbar">
        <span className="searchbar-label">Check them against a policy</span>
        <div className="searchbar-row">
          <input
            list="policy-names"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                apply(pick);
              }
            }}
            placeholder="hiring, landlord, or one of your own"
            aria-label="policy to apply"
            data-testid="policy-pick"
          />
          <datalist id="policy-names">
            {options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
          <button
            type="button"
            className="primary"
            onClick={() => apply(pick)}
            disabled={!named(pick)}
            data-testid="policy-apply"
          >
            Apply
          </button>
        </div>
      </div>

      {applied ? (
        <p className="muted" data-testid="policy-line">
          Checking against: {describePolicy(applied)}.{" "}
          <button className="linkish" onClick={() => router.push(`/p/${handle}`)} data-testid="policy-clear">
            Stop checking
          </button>
        </p>
      ) : (
        <p className="muted">
          Nothing is being checked: everything above is what the records say, not a verdict on it.
        </p>
      )}

      {/* Building one is the rarer half, and it is long. Folded until somebody wants it. */}
      <p>
        <button className="linkish" onClick={() => setBuilding((b) => !b)} data-testid="policy-build">
          {building ? "Hide the builder" : "Build one, or change this one"}
        </button>
      </p>
      {building && <PolicyForm handle={handle} subjectDomains={subjectDomains} />}
    </section>
  );
}
