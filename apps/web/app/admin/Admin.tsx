"use client";

import { useEffect, useMemo, useState } from "react";
import { TxDone } from "@/app/TxDone";
import { useWebConfig } from "@/app/providers";
import type { AdminHumanity, AdminReset, AdminSelfieCheck, AdminUnlink } from "@/lib/api";
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
  const [busy, setBusy] = useState<"look" | "reset" | "switch" | "unlink" | "all">();
  const [resetAll, setResetAll] = useState<{ forgotten: number; deleted: unknown[] }>();
  const [unlinked, setUnlinked] = useState<AdminUnlink>();
  /** The deletion whose confirmation has been read, so closing it does not bring it back */
  const [doneRead, setDoneRead] = useState<string>();
  const [policy, setPolicy] = useState<AdminSelfieCheck>();
  const [policyError, setPolicyError] = useState<string>();
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

  const unlink = async () => {
    if (
      !window.confirm(
        `Unlink every Privy account (email, Google, X, GitHub…) from ${who.trim()}? The wallets stay.`
      )
    )
      return;
    setError(undefined);
    setBusy("unlink");
    try {
      setUnlinked(await api.adminPrivyUnlink(token, query()));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const resetEveryone = async () => {
    if (
      !window.confirm(
        "Reset EVERY Selfie Check on the platform? Every nullifier is forgotten and every live humanity record deleted."
      )
    )
      return;
    setPolicyError(undefined);
    setBusy("all");
    try {
      setResetAll(await api.adminHumanityResetAll(token));
    } catch (e) {
      setPolicyError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const readPolicy = async () => {
    setPolicyError(undefined);
    setBusy("switch");
    try {
      setPolicy(await api.adminSelfieCheck(token));
    } catch (e) {
      setPolicy(undefined);
      setPolicyError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const flip = async () => {
    if (!policy) return;
    const next = !policy.required;
    if (
      !window.confirm(
        next ? "Require the Selfie Check again, for everyone?" : "Turn the Selfie Check off for everyone?"
      )
    )
      return;
    setPolicyError(undefined);
    setBusy("switch");
    try {
      setPolicy(await api.adminSelfieCheckSet(token, next));
    } catch (e) {
      setPolicyError((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  // A reset forgets nullifiers whether or not there was a record to delete; only a deletion is a
  // transaction, so only that one has anything to confirm.
  const deleted = result?.deleted && "txHash" in result.deleted ? result.deleted.txHash : undefined;

  return (
    <>
      <section className="card" data-testid="admin-policy">
        <h2>Selfie Check, for everyone</h2>
        <p className="warning">
          Demo only. Off, no reference needs a proof of humanity and the browser stops asking for one, on
          every account at once. It comes back on with the same switch.
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
        <p className="row">
          <button
            type="button"
            onClick={readPolicy}
            disabled={!token || !!busy}
            data-testid="admin-policy-read"
          >
            {busy === "switch" && !policy ? "reading…" : "Read the switch"}
          </button>
          <button
            type="button"
            className="primary"
            onClick={flip}
            disabled={!policy || !!busy}
            data-testid="admin-policy-flip"
          >
            {policy?.required ? "Turn the Selfie Check off for everyone" : "Require the Selfie Check again"}
          </button>
          <button
            type="button"
            onClick={resetEveryone}
            disabled={!token || !!busy}
            data-testid="admin-reset-all"
          >
            {busy === "all" ? "resetting…" : "Reset every Selfie Check"}
          </button>
        </p>
        {resetAll && (
          <p className="muted" data-testid="admin-reset-all-result">
            Forgot {resetAll.forgotten} {resetAll.forgotten === 1 ? "nullifier" : "nullifiers"}, deleted{" "}
            {resetAll.deleted.length} {resetAll.deleted.length === 1 ? "record" : "records"} on chain.
          </p>
        )}
        {policy && (
          <p className="muted" data-testid="admin-policy-state">
            Right now: {policy.required ? "required" : "off"}
            {policy.configured !== policy.required &&
              ` (configured: ${policy.configured ? "required" : "off"})`}
            .
          </p>
        )}
        {policyError && (
          <p className="error" role="alert" data-testid="admin-policy-error">
            {policyError}
          </p>
        )}
      </section>
      <section className="card" data-testid="admin">
        <h2>Reset a Selfie Check</h2>
        <p className="warning">
          Demo only. This forgets the person&apos;s nullifier and deletes their humanity record on chain, so
          they can pass the check again. It answers only where the registrar is this deployment&apos;s own
          node.
        </p>
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
          <button
            type="button"
            onClick={unlink}
            disabled={!token || !who.trim() || !!busy}
            data-testid="admin-unlink"
          >
            {busy === "unlink" ? "unlinking…" : "Unlink Privy accounts"}
          </button>
        </p>
        {unlinked && (
          <p className="muted" data-testid="admin-unlinked">
            Unlinked {unlinked.unlinked.length ? unlinked.unlinked.map((u) => u.type).join(", ") : "nothing"}{" "}
            from <code>{unlinked.did}</code>.
            {unlinked.failed.length > 0 &&
              ` Privy refused: ${unlinked.failed.map((f) => `${f.type} (${f.status})`).join(", ")}.`}
          </p>
        )}
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
        {deleted && doneRead !== deleted && (
          <TxDone title="Record deleted" hash={deleted} onClose={() => setDoneRead(deleted)} />
        )}
      </section>
    </>
  );
}
