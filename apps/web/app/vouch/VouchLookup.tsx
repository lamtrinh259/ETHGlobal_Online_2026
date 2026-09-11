"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useWebConfig } from "@/app/providers";
import { apiFor } from "@/lib/hooks";
import { PersonSearch } from "@/app/PersonSearch";

/**
 * Who asked you.
 *
 * One field, the same one a verifier uses. It carried a second input for an exact handle as well,
 * which repeated the search and checked the name a second time — and the candidate's own page says
 * whether the name is claimed, expired or unheld anyway, on the screen where the reference gets
 * written. Learning it one step earlier was not worth asking the question twice.
 */
export function VouchLookup() {
  const router = useRouter();
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);

  return (
    <div className="card">
      <PersonSearch
        api={api}
        onPick={(h) => router.push(`/vouch/${h}`)}
        action="Write their reference"
        autoFocus
        label="Who asked you?"
      />
    </div>
  );
}
