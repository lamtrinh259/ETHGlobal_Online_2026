import { recoverTypedDataAddress, type Address, type Hex, type TypedDataDomain } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Intent } from "./types.js";

/**
 * EIP-712 type of the wallet-signed intent. `optIn` is inside the typehash so
 * the privacy choice is a signed choice (B.4).
 */
export const INTENT_TYPES = {
  Intent: [
    { name: "wallet", type: "address" },
    { name: "domain", type: "string" },
    { name: "nonce", type: "uint96" },
    { name: "exp", type: "uint256" },
    { name: "optIn", type: "bool" },
    { name: "pubkey", type: "bytes" },
    { name: "handle", type: "string" },
    { name: "payload", type: "bytes32" },
  ],
} as const;

/** Intent domain is separated from Multipass's own domain; `verifyingContract` pins the store */
export function intentDomain(chainId: number, multipass: Address): TypedDataDomain {
  return { name: "Attestation Intent", version: "1", chainId, verifyingContract: multipass };
}

export async function recoverIntentSigner(
  intent: Intent,
  signature: Hex,
  domain: TypedDataDomain
): Promise<Address> {
  return recoverTypedDataAddress({
    domain,
    types: INTENT_TYPES,
    primaryType: "Intent",
    message: intent,
    signature,
  });
}

/** Client / test helper: sign an intent with a local account */
export async function signIntent(
  account: PrivateKeyAccount,
  intent: Intent,
  domain: TypedDataDomain
): Promise<Hex> {
  return account.signTypedData({ domain, types: INTENT_TYPES, primaryType: "Intent", message: intent });
}
