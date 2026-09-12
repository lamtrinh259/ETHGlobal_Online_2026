import { recoverTypedDataAddress, type Address, type Hex, type TypedDataDomain } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";

/**
 * A verifier's invitation to be read against their policy.
 *
 * The other invitation here runs the other way — a candidate inviting somebody to write for them.
 * This one is an employer, holding a name, asking a person who has no page yet to make one and be
 * read against a stated bar: "peersky.ketsuban.eth is inviting you to pass their policy; begin by
 * connecting your github.com account". The person is named by the account the employer knows them
 * by, because that is all the employer knows, and the account is what the page will attach to.
 *
 * Signed by the wallet holding `inviter` in the root name domain, so the line "X is inviting you"
 * is X's own claim and not one this service made up. Everything a reader is told is in the message.
 */
export const POLICY_INVITE_TYPES = {
  PolicyInvite: [
    { name: "inviter", type: "string" },
    { name: "platform", type: "string" },
    { name: "account", type: "string" },
    { name: "policy", type: "string" },
    { name: "exp", type: "uint256" },
  ],
} as const;

export type PolicyInvite = {
  /** The employer's handle in the root name domain */
  inviter: string;
  /** Where the employer knows the person from: a DNS domain this deployment attests, e.g. `github.com` */
  platform: string;
  /** Their handle there, without the `@` */
  account: string;
  policy: string;
  /** Unix seconds */
  exp: bigint;
};

export type SignedPolicyInvite = PolicyInvite & { signature: Hex };

/** Separated from the other domains so this can never be replayed as an intent or a vouch invitation */
export function policyInviteDomain(chainId: number, multipass: Address): TypedDataDomain {
  return { name: "Ketsuban Policy Invite", version: "1", chainId, verifyingContract: multipass };
}

export async function recoverPolicyInviteSigner(
  invite: PolicyInvite,
  signature: Hex,
  domain: TypedDataDomain
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: POLICY_INVITE_TYPES,
    primaryType: "PolicyInvite",
    message: invite,
    signature,
  });
}

/** Client / test helper: sign with a local account */
export async function signPolicyInvite(
  account: PrivateKeyAccount,
  invite: PolicyInvite,
  domain: TypedDataDomain
): Promise<Hex> {
  return account.signTypedData({
    domain,
    types: POLICY_INVITE_TYPES,
    primaryType: "PolicyInvite",
    message: invite,
  });
}
