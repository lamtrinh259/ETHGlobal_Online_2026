"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Modal } from "@/app/Modal";
import { PolicyForm } from "@/app/PolicyForm";
import { loadPolicies, type SavedPolicy } from "@/lib/policies";
import { describePolicy, POLICY_PRESETS, policyToQuery, presetPolicy, type Policy } from "@/lib/profile";

/**
 * Applying a bar to somebody, asked for at the top and answered in a dialog.
 *
 * A person's page used to arrive already graded against a default nobody chose: a column of ticks
 * under a word — "incomplete" — passing judgement on a person for a bar they were never told about. A
 * verdict is something a reader performs, so it is asked for. It was asked for in a card near the
 * bottom of the page, which is a strange place for the one thing a verifier came to do, and the bar
 * they chose was set half a page from the checks it produced.
 *
 * So the question is a button under the name, and choosing the bar is a dialog: picking a policy is a
 * decision, not a section of somebody's page. What is in force is said in the same place, beside the
 * badge it explains.
 *
 * The presets are what the platform ships. The rest are the reader's own, kept in their browser,
 * because what somebody's bar is is nobody else's business.
 */
export function PolicyCheck({
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
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<SavedPolicy[]>([]);
  const [pick, setPick] = useState("");
  const [building, setBuilding] = useState(false);
  // Read after mount: storage belongs to the browser, and the server has none to render from.
  useEffect(() => setMine(loadPolicies()), []);

  // The builder navigates rather than reporting back, so the dialog is closed by the bar changing
  // under it — otherwise it sits over the checks it was opened to produce.
  const inForce = applied ? describePolicy(applied) : "";
  useEffect(() => setOpen(false), [inForce]);

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
    setOpen(false);
    router.push(`/p/${handle}?${policyToQuery(policy, preset?.id)}`);
  }

  const options = [...POLICY_PRESETS.map((p) => p.label), ...mine.map((m) => m.name)];

  return (
    <>
      {applied ? (
        <p className="muted" data-testid="policy-line">
          Checking against: {describePolicy(applied)}.{" "}
          <button className="linkish" onClick={() => setOpen(true)} data-testid="policy-change">
            change
          </button>
          {" · "}
          <button className="linkish" onClick={() => router.push(`/p/${handle}`)} data-testid="policy-clear">
            Stop checking
          </button>
        </p>
      ) : (
        <p className="row">
          <button type="button" className="primary" onClick={() => setOpen(true)} data-testid="policy-open">
            Check against a policy
          </button>
        </p>
      )}

      {open && (
        <Modal title="Check against a policy" onClose={() => setOpen(false)}>
          <div className="searchbar">
            <span className="searchbar-label">Check {handle} against a policy</span>
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
                placeholder="hiring, landlord, your own…"
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

          {/* Building one is the rarer half, and it is long. Folded until somebody wants it. */}
          <p>
            <button className="linkish" onClick={() => setBuilding((b) => !b)} data-testid="policy-build">
              {building ? "Hide the builder" : "Build one, or change this one"}
            </button>
          </p>
          {building && <PolicyForm handle={handle} subjectDomains={subjectDomains} />}
        </Modal>
      )}
    </>
  );
}
