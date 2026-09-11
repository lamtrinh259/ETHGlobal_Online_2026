"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useWebConfig } from "@/app/providers";
import { forgetPolicy, loadPolicies, savePolicy, type SavedPolicy } from "@/lib/policies";
import { describePolicy, lookupTarget, POLICY_PRESETS, policyToQuery, presetPolicy } from "@/lib/profile";
import { questionTitle } from "@/lib/questions";

/** Verifier policy picker → /p/<handle>?answers=&minLinks=&humanity= */
export function PolicyForm({ handle, subjectDomains }: { handle: string; subjectDomains: string[] }) {
  const router = useRouter();
  const config = useWebConfig();
  const [answers, setAnswers] = useState<string[]>(subjectDomains);
  const [minLinks, setMinLinks] = useState(1);
  const [minVouches, setMinVouches] = useState(3);
  const [humanity, setHumanity] = useState(false);
  const [onlySolicited, setOnlySolicited] = useState(false);
  const [from, setFrom] = useState("");
  const [mine, setMine] = useState<SavedPolicy[]>([]);
  const [saveAs, setSaveAs] = useState("");
  // Read in the browser: the list lives there, and a server render has no storage to read it from.
  useEffect(() => setMine(loadPolicies()), []);
  const [preset, setPreset] = useState<string | undefined>("hiring");
  const policy = {
    requiredAnswers: answers,
    minLinks,
    requireHumanity: humanity,
    minVouches,
    onlySolicited,
    from: from
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean),
  };

  /** One the verifier wrote: a preset of their own rather than one this platform ships. */
  function applyMine(entry: SavedPolicy) {
    setAnswers(entry.policy.requiredAnswers);
    setMinLinks(entry.policy.minLinks);
    setMinVouches(entry.policy.minVouches);
    setHumanity(entry.policy.requireHumanity);
    setOnlySolicited(!!entry.policy.onlySolicited);
    setFrom((entry.policy.from ?? []).join(", "));
    setPreset(undefined);
  }
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
  const target = lookupTarget(handle, policyToQuery(policy, preset));

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!target) return;
        router.push(target.href);
      }}
    >
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
          <input type="checkbox" checked={humanity} onChange={(e) => custom(setHumanity)(e.target.checked)} />{" "}
          require a humanity attestation
        </label>
        {/*
            A count says how many people spoke and never says who. One name, or a branch —
            `*.acme.com` — matched the way a disclosure audience is, not a second syntax to learn.
          */}
        <label>
          referred by{" "}
          <input
            value={from}
            onChange={(e) => custom(setFrom)(e.target.value)}
            placeholder="bob.ketsuban.eth, *.acme.com"
            aria-label="referred by"
            data-testid="policy-from"
          />
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

        {/* The presets are what this platform ships. What a verifier actually checks is theirs, and
              rebuilding it per candidate is how the bar drifts between one and the next. */}
        <p className="row" data-testid="my-policies">
          {mine.map((entry) => (
            <span key={entry.name} className="row">
              <button type="button" onClick={() => applyMine(entry)} data-testid={`mine-${entry.name}`}>
                {entry.name}
              </button>
              {/* A bar somebody stopped using is one they can be rid of; kept, the list only grows. */}
              <button
                type="button"
                className="linkish"
                onClick={() => setMine(forgetPolicy(entry.name))}
                aria-label={`forget ${entry.name}`}
                data-testid={`forget-${entry.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </p>
        <p className="row">
          <input
            value={saveAs}
            onChange={(e) => setSaveAs(e.target.value)}
            placeholder="name this policy"
            aria-label="name this policy"
            data-testid="policy-name"
          />
          <button
            type="button"
            disabled={!saveAs.trim()}
            onClick={() => {
              setMine(savePolicy({ name: saveAs.trim(), policy }));
              setSaveAs("");
            }}
            data-testid="save-policy"
          >
            Save this policy
          </button>
        </p>
      </fieldset>
      <button type="submit" className="primary" disabled={!target}>
        Apply to {handle}
      </button>
    </form>
  );
}
