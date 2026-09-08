import { secp256k1 } from "@noble/curves/secp256k1";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import type { EciesBox } from "./types";

const KEY_INFO = "att/ecies/key";
const NONCE_INFO = "att/ecies/nonce";

/** Map an arbitrary seed to a valid secp256k1 scalar (re-hash on the negligible miss) */
function seedToPrivateKey(seed: Uint8Array): Uint8Array {
  let k = sha256(seed);
  while (!secp256k1.utils.isValidPrivateKey(k)) k = sha256(k);
  return k;
}

function deriveKeys(shared: Uint8Array): { key: Uint8Array; nonce: Uint8Array } {
  return {
    key: hkdf(sha256, shared, undefined, KEY_INFO, 32),
    nonce: hkdf(sha256, shared, undefined, NONCE_INFO, 24),
  };
}

/**
 * ECIES (secp256k1 ECDH → HKDF-SHA256 → XChaCha20-Poly1305).
 *
 * `ephemeralSeed` makes encryption deterministic: every DON replica must
 * produce byte-identical output for consensus (B.4). Derive the seed from a
 * secret plus the plaintext so it is unpredictable to anyone else.
 */
export function eciesEncrypt(recipientPubkey: Hex, plaintext: Uint8Array, ephemeralSeed: Uint8Array): EciesBox {
  const ephPriv = seedToPrivateKey(ephemeralSeed);
  const ephPub = secp256k1.getPublicKey(ephPriv, true);
  const shared = secp256k1.getSharedSecret(ephPriv, hexToBytes(recipientPubkey), true);
  const { key, nonce } = deriveKeys(shared);
  return {
    ephemeralPubkey: bytesToHex(ephPub),
    nonce: bytesToHex(nonce),
    ciphertext: bytesToHex(xchacha20poly1305(key, nonce).encrypt(plaintext)),
  };
}

/** Client side: open the box with the wallet's private key */
export function eciesDecrypt(recipientPrivkey: Hex, box: EciesBox): Uint8Array {
  const shared = secp256k1.getSharedSecret(hexToBytes(recipientPrivkey), hexToBytes(box.ephemeralPubkey), true);
  const { key, nonce } = deriveKeys(shared);
  if (bytesToHex(nonce) !== box.nonce) throw new Error("ecies: nonce mismatch");
  return xchacha20poly1305(key, nonce).decrypt(hexToBytes(box.ciphertext));
}
