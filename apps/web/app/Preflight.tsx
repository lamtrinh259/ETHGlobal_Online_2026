"use client";

import { useMemo } from "react";
import { useWebConfig } from "./providers";
import { apiFor, usePreflight } from "@/lib/hooks";

/**
 * The deployment telling on itself. A domain that was never initialised or a registrar key that
 * Multipass does not expect makes every signature fail, so it belongs in front of the forms rather
 * than in a revert afterwards.
 */
export function Preflight() {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const p = usePreflight(api);
  if (!p.data || p.data.ok) return null;
  return (
    <section className="card error" role="alert" data-testid="preflight">
      <h2>This deployment is not ready</h2>
      <p>Signing will fail until these are fixed:</p>
      <ul>
        {p.data.warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
    </section>
  );
}
