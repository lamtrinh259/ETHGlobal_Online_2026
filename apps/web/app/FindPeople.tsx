"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMemo } from "react";
import { PersonSearch } from "@/app/PersonSearch";
import { useWebConfig } from "@/app/providers";
import { apiFor } from "@/lib/hooks";

/**
 * The front page is the search.
 *
 * Everyone who arrives is asking about somebody — a candidate, a name in a message, a page they were
 * sent. Three doors asked them to classify themselves first. With nothing typed the same field
 * answers the broader question: who here has people behind them.
 */
export function FindPeople({
  subjects,
}: {
  /** Pinned above the people: a subject is a page anybody can answer under, not a person */
  subjects: { domain: string; parentName: string; title: string; name?: string; about?: string }[];
}) {
  const router = useRouter();
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);

  return (
    <section className="card" data-testid="find-people">
      <PersonSearch
        api={api}
        onPick={(h) => router.push(`/p/${h}`)}
        action="Open"
        autoFocus
        label="Who are you checking?"
      />

      {subjects.length > 0 && (
        <ul className="open-questions" data-testid="open-questions">
          {subjects.map((s) => (
            <li key={s.domain}>
              <Link href={`/v/${s.parentName}`}>{s.title}</Link>
              {s.name && <strong>{s.name}</strong>}
              {s.about && <small className="muted open-question-about">{s.about}</small>}
              <small className="muted">
                <code>{s.parentName}</code>
              </small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
