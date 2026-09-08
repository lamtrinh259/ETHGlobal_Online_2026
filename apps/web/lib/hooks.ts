"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hex } from "viem";
import { createApi, type Api, type AttestResult, type Verification } from "./api";
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
    },
  });
}
