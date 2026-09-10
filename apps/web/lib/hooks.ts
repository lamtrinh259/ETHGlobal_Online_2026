"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Address, Hex } from "viem";
import { createApi, type Api, type AttestResult, type Verification } from "./api";
import {
  commitEthName,
  linkOwnName,
  registerEthName,
  writeProfileText,
  type EthNameParams,
  type ProfileKey,
  type Signer,
} from "./chain";
import type { WebConfig } from "./config";

/** One client per config; the hooks below are the only place components touch the API. */
export function apiFor(config: WebConfig): Api {
  return createApi(config.apiUrl, config.attestUrl);
}

/** On-chain nonce for (wallet, domain) — the intent must carry `next`. Refetched after every publish. */
export function useNonce(api: Api, wallet: Address | undefined, domain: string) {
  return useQuery({
    queryKey: ["nonce", wallet, domain],
    queryFn: () => api.nonce(wallet as Address, domain),
    enabled: !!wallet && !!domain,
    staleTime: 0,
  });
}

/** Public verification card for a name; `viewCode` discloses opted-in links. */
export function useVerification(api: Api, name: string, opts: { links?: string[]; viewCode?: Hex } = {}) {
  return useQuery({
    queryKey: ["verify", name, opts.links?.join(",") ?? "", opts.viewCode ?? ""],
    queryFn: (): Promise<Verification> => api.verify(name, opts),
    enabled: !!name,
  });
}

/** Is a handle free in a name domain? Enabled only for well-formed handles; the caller debounces. */
export function useNameStatus(api: Api, domain: string, handle: string, enabled = true) {
  return useQuery({
    queryKey: ["name", domain, handle],
    queryFn: () => api.nameStatus(domain, handle),
    enabled: enabled && !!domain && /^[a-z0-9-]{1,31}$/.test(handle),
    staleTime: 10_000,
  });
}

/** A wallet's dashboard: names, links, references given. */
export function useWalletDashboard(api: Api, address: Address | undefined, awaiting = false) {
  return useQuery({
    queryKey: ["wallet", address],
    queryFn: () => api.wallet(address as Address),
    enabled: !!address,
    // A record just written has to reach the index before it can be listed. Poll only while something
    // is expected, so the page settles instead of hammering.
    refetchInterval: awaiting ? 2000 : false,
  });
}

/** POST the signed request to the attester. */
export function useAttest(api: Api) {
  return useMutation({ mutationFn: (wire: object) => api.attest(wire) });
}

/** Hand a signed record to the relay; invalidates the nonce so a renewal reads the new one. */
export function useDeliver(api: Api, wallet: Address | undefined, domain: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (result: AttestResult) => api.deliver(result),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["nonce", wallet, domain] });
      void qc.invalidateQueries({ queryKey: ["verify"] });
      void qc.invalidateQueries({ queryKey: ["name"] });
      void qc.invalidateQueries({ queryKey: ["wallet", wallet] });
    },
  });
}

/** Who owns a `.eth` label on the ENSv2 registry, so the form can say what will happen before it happens. */
export function useEthLabel(api: Api, label: string) {
  return useQuery({
    queryKey: ["eth-label", label],
    queryFn: () => api.ethLabel(label),
    enabled: /^[a-z0-9-]{3,63}$/.test(label),
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Get a `.eth` name on a test deployment. The registrar mints only to whoever calls it, and the names it
 * mints do not transfer, so this has to be the person's own wallet: pay, commit, wait, register.
 */
export function useClaimEthName(onDone: () => void) {
  const [waitingUntil, setWaitingUntil] = useState<number>();
  const mutation = useMutation({
    mutationFn: async ({ signer, params }: { signer: Signer; params: EthNameParams }) => {
      const { readyAt } = await commitEthName(signer, params);
      setWaitingUntil(readyAt * 1000);
      const left = readyAt * 1000 - Date.now();
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      setWaitingUntil(undefined);
      return registerEthName(signer, params);
    },
    onSuccess: onDone,
    onError: () => setWaitingUntil(undefined),
  });
  return { ...mutation, waitingUntil };
}

/** Permissions live on a name right now — the answer to "who can read my private accounts". */
export function useDisclosures(api: Api, name: string | undefined) {
  return useQuery({
    queryKey: ["disclosures", name],
    queryFn: () => api.disclosures(name as string),
    enabled: !!name,
  });
}

/** Take a permission back; the list refreshes so the page shows what is true after it. */
export function useRevoke(api: Api, name: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wire: object) => api.revoke(wire),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["disclosures", name] }),
  });
}

export function useContracts(api: Api) {
  return useQuery({ queryKey: ["contracts"], queryFn: () => api.contracts(), staleTime: Infinity });
}

/** Write changed ENS profile records for `name`, one transaction per key; refreshes the verification card. */
export function useProfileWrite(name: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      signer: Signer;
      resolver: Address;
      changes: Partial<Record<ProfileKey, string>>;
    }) => {
      const hashes: Hex[] = [];
      for (const [key, value] of Object.entries(input.changes) as [ProfileKey, string][]) {
        hashes.push(await writeProfileText(input.signer, input.resolver, name, key, value));
      }
      return hashes;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["verify", name] }),
  });
}

/** Write the reference letter as the `description` record on a vouch name; refreshes that candidate's list. */
export function useLetterWrite(candidate: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { signer: Signer; resolver: Address; name: string; letter: string }) =>
      writeProfileText(input.signer, input.resolver, input.name, "description", input.letter),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["vouches", candidate] }),
  });
}

/** Alias `<parentLabel>.<label>.eth` to the caller's record; refreshes the wallet dashboard. */
export function useLinkOwnName(wallet: Address | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { signer: Signer; bridge: Address; domain: string; label: string }) =>
      linkOwnName(input.signer, input.bridge, input.domain, input.label),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wallet", wallet] }),
  });
}

/** Ask the relay for test gas; the dashboard refetches so the balance and the offer update. */
export function useGasTopup(wallet: Address | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (api: Api) => api.gas(wallet as Address),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["wallet", wallet] }),
  });
}

/** References written under a handle, for the candidate's own view of who has spoken. */
export function useVouches(api: Api, handle: string | undefined) {
  return useQuery({
    queryKey: ["vouches", handle],
    queryFn: () => api.vouches(handle as string),
    enabled: !!handle,
  });
}

/**
 * Whether the deployment is wired correctly. Asked once and kept: a misconfigured domain or registrar
 * makes every signature fail, and saying so up front beats a revert after the user has signed.
 */
export function usePreflight(api: Api) {
  return useQuery({
    queryKey: ["preflight"],
    queryFn: () => api.preflight(),
    staleTime: 60_000,
    retry: false,
  });
}

/** What an address is called, read from its Multipass record through the instance resolver. */
export function useReverse(api: Api, address: Address | undefined) {
  return useQuery({
    queryKey: ["reverse", address],
    queryFn: () => api.reverse(address as Address),
    enabled: !!address,
  });
}
