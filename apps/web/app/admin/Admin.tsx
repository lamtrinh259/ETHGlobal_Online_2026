"use client";

import { useEffect, useMemo, useState } from "react";
import { useWebConfig } from "@/app/providers";
import type { AdminHumanity, AdminReset } from "@/lib/api";
import { apiFor } from "@/lib/hooks";

const TOKEN_KEY = "ketsuban:admin-token";

/**
 * Demo only: reset a Selfie Check on a named account.
 *
 * A demo has to run the check again on the same person, and "one human, one account" is exactly what
 * stops that. This forgets the nullifier the attester bound to the wallet and deletes the wallet's
 * humanity record on chain. The token is kept in this tab only; nothing here is a page anybody but the
 * operator should reach, and the API answers 501 wherever the registrar is an enclave.
 */
export function Admin() {
  const config = useWebConfig();
  const api = useMemo(() => apiFor(config), [config]);
  const [token, setToken] = useState("");
  const [who, setWho] = useState("");
  const [state, setState] = useState<AdminHumanity>();
  const [result, setResult] = useState<AdminReset>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState<"look" | "reset">();
  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(TOKEN_KEY) ?? "");
    } catch {
      // A browser that refuses storage: the token is typed each time.
    }
  }, []);
  const remember = (t: string) => {
    setToken(t);
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
    } catch {
      // As above.
    }
  };
  const query = () => {
    const q = who.trim();
    return /^0x[0-9a-fA-F]{40}$/.test(q) ? { wallet: q } : { handle: q.toLowerCase() };
  };

  const look = async () => {
    setError(undefined);
    setResult(undefined);
    setBusy("look");
    try {
      setState(await api.adminHumanity(token, query()));
    } catch (e) {
      setState(undefined);
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const reset = async () => {
    if (!window.confirm(`Reset the Selfie Check on ${who.trim()}? The record on chain is deleted.`)) return;
    setError(undefined);
    setBusy("reset");
    try {
      setResult(await api.adminHumanityReset(token, query()));
      setState(await api.adminHumanity(token, query()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="card" data-testid="admin">
      <h2>Reset a Selfie Check</h2>
      <p className="warning">
        Demo only. This forgets the person&apos;s nullifier and deletes their humanity record on chain, so
        they can pass the check again. It answers only where the registrar is this deployment&apos;s own node.
      </p>
      <label>
        Admin token
        <input
          type="password"
          value={token}
          onChange={(e) => remember(e.target.value)}
          placeholder="ADMIN_TOKEN"
          aria-label="admin token"
          data-testid="admin-token"
        />
        <small className="muted">Kept in this tab only.</small>
      </label>
      <label>
        Account
        <input
          value={who}
          onChange={(e) => setWho(e.target.value)}
          placeholder="handle, or 0x… wallet"
          aria-label="account"
          data-testid="admin-who"
        />
      </label>
      <p className="row">
        <button
          type="button"
          onClick={look}
          disabled={!token || !who.trim() || !!busy}
          data-testid="admin-look"
        >
          {busy === "look" ? "reading…" : "Look up"}
        </button>
        <button
          type="button"
          className="primary"
          onClick={reset}
          disabled={!state || !!busy}
          data-testid="admin-reset"
        >
          {busy === "reset" ? "resetting…" : "Reset the Selfie Check"}
        </button>
      </p>
      {error && (
        <p className="error" role="alert" data-testid="admin-error">
          {error}
        </p>
      )}
      {state && (
        <dl className="admin-state" data-testid="admin-state">
          <div>
            <dt>wallet</dt>
            <dd>
              <code>{state.wallet}</code>
              {state.handle && <> · {state.handle}</>}
            </dd>
          </div>
          <div>
            <dt>humanity record on chain</dt>
            <dd data-testid="admin-onchain">
              {state.onchain.exists ? `yes, nonce ${state.onchain.nonce}` : "none"}
            </dd>
          </div>
          <div>
            <dt>nullifiers bound here</dt>
            <dd data-testid="admin-bound">{state.bound}</dd>
          </div>
        </dl>
      )}
      {result && (
        <p className="muted" data-testid="admin-result">
          Forgot {result.forgotten} {result.forgotten === 1 ? "nullifier" : "nullifiers"}.{" "}
          {!result.existed
            ? "There was no record on chain."
            : result.deleted && "txHash" in result.deleted
              ? `Deleted the record on chain: ${result.deleted.txHash}.`
              : `The record on chain could not be deleted: ${result.deleted && "error" in result.deleted ? result.deleted.error : "unknown"}.`}
        </p>
      )}
    </section>
  );
}
