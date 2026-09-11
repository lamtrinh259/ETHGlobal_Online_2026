"use client";

import { useRouter } from "next/navigation";
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
  subjects: {
    domain: string;
    parentName: string;
    title: string;
    name?: string;
    about?: string;
    /** How many people have answered under it, which is what the list is ranked on */
    answers?: number;
  }[];
}) {
  const router = useRouter();
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);

  return (
    <section className="card" data-testid="find-people">
      <PersonSearch
        api={api}
        onPick={(h) => router.push(`/p/${h}`)}
        onAddress={(a) => router.push(`/w/${a}`)}
        action="Open"
        also={{ label: "Refer", onPick: (h) => router.push(`/vouch/${h}`) }}
        autoFocus
        big
        label="Who are you checking?"
        pinned={subjects.map((s) => ({
          href: `/v/${s.parentName}`,
          label: s.name ?? s.title,
          // Said in the same terms as every other row, because it sits in the same ranking.
          note:
            s.answers === undefined
              ? s.title
              : `${s.answers} ${s.answers === 1 ? "answer" : "answers"} · ${s.title}`,
        }))}
      />
    </section>
  );
}
