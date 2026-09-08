"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { describePolicy, HANDLE_RE, POLICY_PRESETS, policyToQuery, presetPolicy } from "@/lib/profile";

/** Verifier policy picker → /p/<handle>?answers=&minLinks=&humanity= */
export function VerifyForm({ subjectDomains }: { subjectDomains: string[] }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [answers, setAnswers] = useState<string[]>(subjectDomains);
  const [minLinks, setMinLinks] = useState(1);
  const [minVouches, setMinVouches] = useState(3);
  const [humanity, setHumanity] = useState(false);
  const [preset, setPreset] = useState<string | undefined>("hiring");
  const policy = { requiredAnswers: answers, minLinks, requireHumanity: humanity, minVouches };
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
    setPreset(id);
  }
  const clean = handle
    .trim()
    .toLowerCase()
    .replace(/\.ketsuban\.eth$/, "");
  const valid = HANDLE_RE.test(clean);

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        router.push(`/p/${clean}?${policyToQuery(policy, preset)}`);
      }}
    >
      <label>
        handle{" "}
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="alice"
          aria-label="handle"
          autoFocus
        />
      </label>
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
            require an answer for <code>{d}</code>
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
        <p className="muted" data-testid="policy-summary">
          {describePolicy(policy)}
        </p>
      </fieldset>
      <button type="submit" className="primary" disabled={!valid}>
        Check
      </button>
    </form>
  );
}
