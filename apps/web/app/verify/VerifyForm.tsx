"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HANDLE_RE } from "@/lib/profile";

/** Verifier policy picker → /p/<handle>?answers=&minLinks=&humanity= */
export function VerifyForm({ subjectDomains }: { subjectDomains: string[] }) {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [answers, setAnswers] = useState<string[]>(subjectDomains);
  const [minLinks, setMinLinks] = useState(1);
  const [humanity, setHumanity] = useState(false);
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
        const q = new URLSearchParams({ answers: answers.join(","), minLinks: String(minLinks) });
        if (humanity) q.set("humanity", "1");
        router.push(`/p/${clean}?${q.toString()}`);
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
        {subjectDomains.map((d) => (
          <label key={d}>
            <input
              type="checkbox"
              checked={answers.includes(d)}
              onChange={(e) => setAnswers((a) => (e.target.checked ? [...a, d] : a.filter((x) => x !== d)))}
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
            onChange={(e) => setMinLinks(Number(e.target.value))}
          />
        </label>
        <label>
          <input type="checkbox" checked={humanity} onChange={(e) => setHumanity(e.target.checked)} /> require
          a humanity attestation
        </label>
      </fieldset>
      <button type="submit" className="primary" disabled={!valid}>
        Check
      </button>
    </form>
  );
}
