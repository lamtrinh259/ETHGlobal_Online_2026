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
        onAddress={(a) => router.push(`/w/${a}`)}
        action="Open"
        also={{ label: "Refer", onPick: (h) => router.push(`/vouch/${h}`) }}
        autoFocus
        big
        label="Who are you checking?"
        pinned={subjects.map((s) => ({
          href: `/v/${s.parentName}`,
          label: s.name ?? s.title,
          note: s.title,
        }))}
      />
    </section>
  );
}
