const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP: Record<string, number> = Object.fromEntries([...ALPHABET].map((c, i) => [c, i]));
LOOKUP["+"] = 62;
LOOKUP["/"] = 63;

/** Decode base64url (or base64) without Buffer/atob — QuickJS-safe */
export function base64urlDecode(input: string): Uint8Array {
  const s = input.replace(/=+$/, "");
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of s) {
    const v = LOOKUP[ch];
    if (v === undefined) throw new Error(`base64url: invalid character "${ch}"`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

export function base64urlEncode(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let acc = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(acc >> bits) & 0x3f];
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (6 - bits)) & 0x3f];
  return out;
}
