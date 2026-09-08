import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { eciesDecrypt, type EciesBox } from "@ketsuban/registrar";

const STORAGE_KEY = "ketsuban:viewcode-key";

export type ViewKey = { privateKey: Hex; publicKey: Hex };

/**
 * The browser keypair the enclave encrypts view codes to (`intent.pubkey`). Embedded wallets never
 * expose their private key, so a dedicated key lives in this browser's storage. Losing it means
 * re-attesting: the registrar re-derives the same view code for the same account.
 */
export function loadOrCreateViewKey(storage: Pick<Storage, "getItem" | "setItem"> = localStorage): ViewKey {
  const stored = storage.getItem(STORAGE_KEY);
  if (stored && /^0x[0-9a-fA-F]{64}$/.test(stored)) return fromPrivateKey(stored as Hex);
  const priv = bytesToHex(secp256k1.utils.randomPrivateKey());
  storage.setItem(STORAGE_KEY, priv);
  return fromPrivateKey(priv);
}

export function fromPrivateKey(privateKey: Hex): ViewKey {
  return { privateKey, publicKey: bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true)) };
}

/** Open the enclave's view-code box with this browser's key */
export function openViewCode(key: ViewKey, box: EciesBox): Hex {
  return bytesToHex(eciesDecrypt(key.privateKey, box));
}
