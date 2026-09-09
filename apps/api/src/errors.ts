import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";
import { MultipassAbi } from "@peeramid-labs/multipass-client";
import { bridgeAbi, errorsAbi, factoryAbi } from "./abi.js";

/**
 * What each revert means for whoever has to fix it. Multipass's errors name the rule that failed, not
 * the cause, so the hint says which knob is wrong — the message a user sees is the only place this
 * knowledge exists otherwise.
 */
const HINTS: Record<string, (args: readonly unknown[]) => string> = {
  invalidDomain: ([name]) =>
    `domain ${label(name)} is not initialised on Multipass — run script/InitDomains.s.sol for it`,
  domainNotActive: ([name]) => `domain ${label(name)} exists but is not active on Multipass`,
  invalidSignature: () =>
    "Multipass rejected the registrar signature: the key this service signs with is not the domain's registrar (see /v1/preflight)",
  invalidRegistrar: ([who]) => `${String(who)} is not the registrar for that domain`,
  recordExists: () => "a record already exists for that id: this is a renewal, not a registration",
  invalidNonce: ([n]) => `nonce ${String(n)} is not usable for that record`,
  invalidNonceIncrement: ([have, want]) =>
    `nonce must increase: on chain ${String(have)}, signed ${String(want)}`,
  signatureExpired: ([until]) => `the signed record expired at ${String(until)}`,
  paymentTooLow: ([need, sent]) => `the domain fee is ${String(need)} wei and ${String(sent)} was sent`,
  walletMismatch: ([have, want]) => `that record belongs to ${String(have)}, not ${String(want)}`,
  idMismatch: () => "the record's id does not match the one on chain",
  userNotFound: () => "no record to renew for that query",
  nameExists: ([name]) => `the name ${label(name)} is taken in that domain`,
  OwnableUnauthorizedAccount: ([who]) => `${String(who)} does not own the contract it called`,
};

function label(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("0x")) return String(value);
  const text = Buffer.from(value.slice(2), "hex").toString("utf8").replace(/\0+$/, "");
  return /^[\x20-\x7e]+$/.test(text) ? `"${text}"` : value;
}

const ABIS = [errorsAbi, MultipassAbi, bridgeAbi, factoryAbi] as const;

/** Decode revert data against every ABI in this service, so a selector never reaches a user. */
export function decodeRevert(data: Hex): { name: string; args: readonly unknown[] } | undefined {
  for (const abi of ABIS) {
    try {
      const decoded = decodeErrorResult({ abi, data });
      return { name: decoded.errorName, args: decoded.args ?? [] };
    } catch {
      // not this ABI's error
    }
  }
  return undefined;
}

/**
 * Errors that belong to contracts this build has no ABI for, met while testing against the live ENSv2
 * deployment. A bare selector tells a user nothing, and this is the sentence they can act on.
 */
const KNOWN_SELECTORS: Record<string, string> = {
  "0x4b27a133":
    "the resolver refused: this wallet holds no role for that key on that name — the bridge grants avatar, description, url and email to the wallet a name lands on, and nothing else",
};

/** Turn a contract failure into one sentence naming the rule that failed and what to change. */
export function explainRevert(err: unknown): string {
  const data = revertData(err);
  const known = data && KNOWN_SELECTORS[data.slice(0, 10).toLowerCase()];
  if (known) return known;
  const decoded = data ? decodeRevert(data) : undefined;
  if (!decoded) return (err as Error)?.message?.split("\n")[0] ?? String(err);
  const hint = HINTS[decoded.name]?.(decoded.args);
  const args = decoded.args.length > 0 ? `(${decoded.args.map(label).join(", ")})` : "";
  return hint ? `${decoded.name}: ${hint}` : `${decoded.name}${args}`;
}

/**
 * The full revert bytes, wherever viem put them. `raw` carries the arguments; `signature` is only the
 * four-byte selector, which decodes nothing for an error that takes parameters, so it comes last.
 */
function revertData(err: unknown): Hex | undefined {
  if (err instanceof BaseError) {
    const hex = (value: unknown) =>
      typeof value === "string" && value.startsWith("0x") ? (value as Hex) : undefined;
    const carrier = err.walk(
      (e) => !!hex((e as { raw?: unknown }).raw) || !!hex((e as { data?: unknown }).data)
    );
    const raw =
      hex((carrier as { raw?: unknown } | undefined)?.raw) ??
      hex((carrier as { data?: unknown } | undefined)?.data);
    if (raw) return raw;
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError && reverted.signature)
      return reverted.signature as Hex;
  }
  const match = /0x[0-9a-fA-F]{8,}/.exec((err as Error)?.message ?? "");
  return match ? (match[0] as Hex) : undefined;
}
