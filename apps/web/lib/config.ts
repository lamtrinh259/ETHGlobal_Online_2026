import { getAddress } from "viem";
import { z } from "zod";

const schema = z.object({
  privyAppId: z.string().min(1),
  privyClientId: z.string().min(1),
  apiUrl: z.string().url(),
  attestUrl: z.string().url(),
  chainId: z.coerce.number().int().positive(),
  // EIP-55 casing is a checksum, and viem refuses an address whose casing does not match its own. An
  // address pasted in lower case from an explorer is the same address; normalising here keeps that
  // from surfacing much later as a transaction that will not build.
  multipass: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .transform((v) => getAddress(v)),
  nameDomains: z.array(z.string().min(1)).min(1),
  parentNames: z.array(z.string().min(1)).min(1),
});

export type WebConfig = z.infer<typeof schema> & {
  instances: { domain: string; parentName: string; parentLabel: string }[];
};

const split = (s: string | undefined) =>
  (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Browser configuration from NEXT_PUBLIC_* — identifiers only, never secrets */
export function loadWebConfig(env: Record<string, string | undefined> = process.env): WebConfig {
  const c = schema.parse({
    privyAppId: env.NEXT_PUBLIC_PRIVY_APP_ID,
    privyClientId: env.NEXT_PUBLIC_PRIVY_CLIENT_ID,
    apiUrl: env.NEXT_PUBLIC_API_URL,
    attestUrl: env.NEXT_PUBLIC_ATTEST_URL,
    chainId: env.NEXT_PUBLIC_CHAIN_ID,
    multipass: env.NEXT_PUBLIC_MULTIPASS,
    nameDomains: split(env.NEXT_PUBLIC_NAME_DOMAINS),
    parentNames: split(env.NEXT_PUBLIC_PARENT_NAMES),
  });
  if (c.nameDomains.length !== c.parentNames.length) {
    throw new Error("NEXT_PUBLIC_NAME_DOMAINS and NEXT_PUBLIC_PARENT_NAMES must have the same length");
  }
  return {
    ...c,
    instances: c.nameDomains.map((domain, i) => ({
      domain,
      parentName: c.parentNames[i],
      parentLabel: c.parentNames[i].split(".")[0],
    })),
  };
}
