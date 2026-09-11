"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PersonSearch } from "@/app/PersonSearch";
import { useWebConfig } from "@/app/providers";
import { apiFor } from "@/lib/hooks";
import { describePolicy, lookupTarget, POLICY_PRESETS, policyToQuery, presetPolicy } from "@/lib/profile";
import { questionTitle } from "@/lib/questions";

/** Verifier policy picker → /p/<handle>?answers=&minLinks=&humanity= */
export function VerifyForm({ subjectDomains }: { subjectDomains: string[] }) {
  const router = useRouter();
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const [answers, setAnswers] = useState<string[]>(subjectDomains);
  const [minLinks, setMinLinks] = useState(1);
  const [minVouches, setMinVouches] = useState(3);
  const [humanity, setHumanity] = useState(false);
  const [onlySolicited, setOnlySolicited] = useState(false);
  const [preset, setPreset] = useState<string | undefined>("hiring");
  const policy = { requiredAnswers: answers, minLinks, requireHumanity: humanity, minVouches, onlySolicited };
  const custom =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      setPreset(undefined);
      set(v);
    };
  function applyPreset(id: string) {
    const p = POLICY_PRESETS.find((x) => x.id === id);
    if (!p) return;
    const pol = presetPolicy(p, subjectDomains);
    setAnswers(pol.requiredAnswers);
    setMinLinks(pol.minLinks);
    setMinVouches(pol.minVouches);
    setHumanity(pol.requireHumanity);
    setOnlySolicited(!!pol.onlySolicited);
    setPreset(id);
  }
  /*
   * Who first, then what to ask of them.
   *
   * The policy was on screen before anybody had been chosen, beside a second field that asked for the
   * exact handle the search above it existed to find. A verifier arrives knowing a person, not a
   * policy, so the policy is the second question and it is asked about somebody by name.
   */
  const [picked, setPicked] = useState<string | undefined>();
  const target = picked ? lookupTarget(picked, policyToQuery(policy, preset)) : undefined;

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        router.push(target.href);
      }}
    >
      {/* A verifier is usually given a name or an account, not the exact handle. Searching first
          means a near miss shows the person rather than an empty page. */}
      {!picked ? (
        <PersonSearch
          api={api}
          onPick={setPicked}
          onAddress={(a) => router.push(`/w/${a}`)}
          action="Check this one"
          autoFocus
        />
      ) : (
        <p className="row" data-testid="picked">
          Checking <strong>{picked}</strong>
          <button type="button" className="linkish" onClick={() => setPicked(undefined)} data-testid="repick">
            change
          </button>
        </p>
      )}

      {picked && (
        <fieldset>
          <legend>Policy</legend>
          <p className="row" data-testid="presets">
            {POLICY_PRESETS.map((p) => (
              <button
                type="button"
                key={p.id}
                className={preset === p.id ? "primary" : ""}
                onClick={() => applyPreset(p.id)}
                title={p.blurb}
                data-testid={`preset-${p.id}`}
              >
                {p.label}
              </button>
            ))}
          </p>
          {subjectDomains.map((d) => (
            <label key={d}>
              <input
                type="checkbox"
                checked={answers.includes(d)}
                onChange={(e) =>
                  custom((checked: boolean) =>
                    setAnswers((a) => (checked ? [...a, d] : a.filter((x) => x !== d)))
                  )(e.target.checked)
                }
              />{" "}
              require an answer to <em>{questionTitle(d)}</em>
            </label>
          ))}
          <label>
            minimum linked accounts{" "}
            <input
              type="number"
              min={0}
              max={9}
              value={minLinks}
              onChange={(e) => custom(setMinLinks)(Number(e.target.value))}
              aria-label="minimum linked accounts"
            />
          </label>
          <label>
            minimum live references{" "}
            <input
              type="number"
              min={0}
              max={99}
              value={minVouches}
              onChange={(e) => custom(setMinVouches)(Number(e.target.value))}
              aria-label="minimum live references"
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={humanity}
              onChange={(e) => custom(setHumanity)(e.target.checked)}
            />{" "}
            require a humanity attestation
          </label>
          {/* Anyone may refer anyone, so a verifier who only trusts invited references has to say so. */}
          <label>
            <input
              type="checkbox"
              checked={onlySolicited}
              onChange={(e) => custom(setOnlySolicited)(e.target.checked)}
              data-testid="only-solicited"
            />{" "}
            count only references the candidate asked for
          </label>
          <p className="muted" data-testid="policy-summary">
            {describePolicy(policy)}
          </p>
        </fieldset>
      )}
      {picked && (
        <button type="submit" className="primary" disabled={!target}>
          Check {picked}
        </button>
      )}
    </form>
  );
}
