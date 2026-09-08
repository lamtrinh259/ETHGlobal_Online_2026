import { describe, expect, it } from "vitest";
import { bytesToHex, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base64urlDecode, base64urlEncode } from "../src/base64url.js";
import { eciesDecrypt, eciesEncrypt } from "../src/ecies.js";
import { jwkToPublicKey, verifyEs256Jwt } from "../src/jwt.js";
import { hasLinkedWallet, parseLinkedAccounts, pickPlatformAccount, toPrivyType } from "../src/accounts.js";
import { APP_ID, defaultLinked, mintIdToken, NOW, PRIVY_JWK, USER_KEY, userAccount } from "./fixtures.js";

describe("base64url", () => {
  it("round-trips arbitrary bytes", () => {
    for (const len of [0, 1, 2, 3, 4, 31, 32, 33, 100]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 0xff);
      expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
    }
  });
  it("accepts padded base64 and rejects junk", () => {
    expect(base64urlDecode("aGk=")).toEqual(stringToBytes("hi"));
    expect(base64urlDecode("aGk")).toEqual(stringToBytes("hi"));
    expect(() => base64urlDecode("a$")).toThrow("invalid character");
  });
});

describe("verifyEs256Jwt", () => {
  const opts = { issuer: "privy.io", audience: APP_ID, now: NOW };

  it("verifies a valid token", () => {
    const claims = verifyEs256Jwt(mintIdToken(), PRIVY_JWK, opts);
    expect(claims.aud).toBe(APP_ID);
    expect(JSON.parse(claims.linked_accounts)).toHaveLength(defaultLinked().length);
  });

  it.each([
    ["malformed token", "a.b", "malformed"],
    ["wrong alg", mintIdToken(undefined, { alg: "HS256" }), "unsupported alg"],
    ["wrong issuer", mintIdToken(undefined, { iss: "evil.io" }), "issuer mismatch"],
    ["wrong audience", mintIdToken(undefined, { aud: "other" }), "audience mismatch"],
    ["expired", mintIdToken(undefined, { exp: NOW }), "expired"],
    ["missing sub", mintIdToken(undefined, { sub: "" }), "missing sub"],
    [
      "missing linked_accounts",
      mintIdToken(undefined, { linked_accounts: undefined }),
      "missing linked_accounts",
    ],
    ["bad signature bytes", `${mintIdToken().split(".").slice(0, 2).join(".")}.AAAA`, "bad signature length"],
  ])("rejects %s", (_, token, msg) => {
    expect(() => verifyEs256Jwt(token, PRIVY_JWK, opts)).toThrow(msg);
  });

  it("rejects a tampered payload", () => {
    const [h, , s] = mintIdToken().split(".");
    const p = base64urlEncode(
      stringToBytes(JSON.stringify({ sub: "x", iss: "privy.io", aud: APP_ID, exp: NOW + 1 }))
    );
    expect(() => verifyEs256Jwt(`${h}.${p}.${s}`, PRIVY_JWK, opts)).toThrow("invalid signature");
  });

  it("rejects a non-P-256 jwk", () => {
    expect(() => jwkToPublicKey({ ...PRIVY_JWK, crv: "P-384" as "P-256" })).toThrow("EC P-256");
  });
});

describe("accounts", () => {
  it("maps domains to privy types and rejects unknown", () => {
    expect(toPrivyType("x")).toBe("twitter_oauth");
    expect(() => toPrivyType("nope")).toThrow("unknown platform domain");
  });

  it("parses linked accounts and rejects non-arrays", () => {
    expect(parseLinkedAccounts("[]")).toEqual([]);
    expect(() => parseLinkedAccounts("{}")).toThrow("not an array");
  });

  it("matches wallets case-insensitively", () => {
    expect(hasLinkedWallet(defaultLinked(), userAccount.address.toUpperCase())).toBe(true);
    expect(hasLinkedWallet(defaultLinked(), "0x0000000000000000000000000000000000000001")).toBe(false);
  });

  it("supports telegram camelCase id and rejects accounts without subject/handle", () => {
    expect(
      pickPlatformAccount([{ type: "telegram", telegramUserId: "42", username: "u" }], "telegram")
    ).toEqual({
      subject: "42",
      username: "u",
    });
    expect(() => pickPlatformAccount([{ type: "telegram", username: "u" }], "telegram")).toThrow(
      "no subject"
    );
    expect(() => pickPlatformAccount([{ type: "twitter_oauth", subject: "1" }], "x")).toThrow("no handle");
  });
});

describe("ecies", () => {
  const RECIPIENT_KEY = "0x000000000000000000000000000000000000000000000000000000000000c0de" as const;
  const recipient = privateKeyToAccount(RECIPIENT_KEY);

  it("round-trips and is deterministic for a fixed seed", () => {
    const msg = stringToBytes("view-code");
    const seed = new Uint8Array(32).fill(1);
    const a = eciesEncrypt(recipient.publicKey, msg, seed);
    const b = eciesEncrypt(recipient.publicKey, msg, seed);
    expect(a).toEqual(b);
    expect(eciesDecrypt(RECIPIENT_KEY, a)).toEqual(msg);
    expect(eciesEncrypt(recipient.publicKey, msg, new Uint8Array(32).fill(2))).not.toEqual(a);
  });

  it("fails for the wrong recipient or a tampered box", () => {
    const box = eciesEncrypt(recipient.publicKey, stringToBytes("s"), new Uint8Array(32));
    expect(() => eciesDecrypt(USER_KEY, box)).toThrow();
    const tampered = { ...box, ciphertext: bytesToHex(new Uint8Array(20)) as `0x${string}` };
    expect(() => eciesDecrypt(RECIPIENT_KEY, tampered)).toThrow();
  });
});
