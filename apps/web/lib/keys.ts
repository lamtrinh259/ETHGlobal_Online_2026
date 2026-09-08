import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { eciesDecrypt, type EciesBox } from "@ketsuban/registrar";

const STORAGE_KEY = "ketsuban:viewcode-key";
const CODES_KEY = "ketsuban:viewcodes";

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

type Store = Pick<Storage, "getItem" | "setItem">;

/** View codes opened in this browser, by platform domain — what a disclosure link needs later. */
export function loadViewCodes(storage: Store = localStorage): Record<string, Hex> {
  try {
    const raw = storage.getItem(CODES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, Hex] => typeof e[1] === "string" && /^0x[0-9a-fA-F]+$/.test(e[1])
      )
    );
  } catch {
    return {};
  }
}

export function saveViewCode(domain: string, code: Hex, storage: Store = localStorage): void {
  try {
    storage.setItem(CODES_KEY, JSON.stringify({ ...loadViewCodes(storage), [domain]: code }));
  } catch {
    // storage unavailable (private mode, quota): the code is still shown once on screen
  }
}
