"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HANDLE_RE } from "@/lib/profile";

export function VouchLookup() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const clean = handle.trim().toLowerCase();
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (HANDLE_RE.test(clean)) router.push(`/vouch/${clean}`);
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
      <button type="submit" className="primary" disabled={!HANDLE_RE.test(clean)}>
        Continue
      </button>
    </form>
  );
}
