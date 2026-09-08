"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useWebConfig } from "@/app/providers";
import { apiFor, useNameStatus } from "@/lib/hooks";
import { HANDLE_RE } from "@/lib/profile";

/** Candidate lookup: confirms the handle is claimed before the voucher invests five minutes. */
export function VouchLookup() {
  const router = useRouter();
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const root = config.instances[0];
  const [handle, setHandle] = useState("");
  const clean = handle
    .trim()
    .toLowerCase()
    .replace(new RegExp(`\\.${(root?.parentName ?? "").replace(/\./g, "\\.")}$`), "");
  const [debounced, setDebounced] = useState(clean);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(clean), 350);
    return () => clearTimeout(t);
  }, [clean]);
  const status = useNameStatus(api, root?.domain ?? "", debounced);
  const fresh = status.data?.handle === clean ? status.data : undefined;
  // API unreachable → let the voucher through; the flow itself will report the real error.
  const blocked = !!fresh && !fresh.live;
  const canGo = HANDLE_RE.test(clean) && !blocked;

  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (canGo) router.push(`/vouch/${clean}`);
      }}
    >
      <label>
        candidate handle{" "}
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          placeholder="alice"
          aria-label="handle"
          autoFocus
        />
      </label>
      {fresh && root && (
        <p className={blocked ? "error" : "muted"} data-testid="lookup-status">
          {fresh.live ? (
            <>
              <code>
                {clean}.{root.parentName}
              </code>{" "}
              is claimed — your reference lands as{" "}
              <code>
                &lt;you&gt;.{clean}.{root.parentName}
              </code>
              .
            </>
          ) : fresh.taken ? (
            <>
              <code>
                {clean}.{root.parentName}
              </code>{" "}
              has expired. Ask them to renew it first; a reference needs a live name to hang on.
            </>
          ) : (
            <>
              Nobody has claimed{" "}
              <code>
                {clean}.{root.parentName}
              </code>{" "}
              yet. Send them <code>{typeof window === "undefined" ? "" : window.location.origin}/claim</code>{" "}
              first.
            </>
          )}
        </p>
      )}
      <button type="submit" className="primary" disabled={!canGo}>
        Continue
      </button>
    </form>
  );
}
