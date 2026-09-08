"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { createApi, type Api, type AttestResult, type Verification } from "./api";
import { linkOwnName, writeProfileText, type ProfileKey, type Signer } from "./chain";
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
export function useWalletDashboard(api: Api, address: Address | undefined) {
  return useQuery({
    queryKey: ["wallet", address],
    queryFn: () => api.wallet(address as Address),
    enabled: !!address,
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

/** Contract addresses the wallet writes to directly (cached: they never change for a deployment). */
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
