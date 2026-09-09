import { describe, expect, it } from "vitest";
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, parseAbi } from "viem";
import { MultipassAbi, toBytes32 } from "@peeramid-labs/multipass-client";
import { decodeRevert, explainRevert } from "../../src/errors.js";

/** The selectors that actually reached users before the errors ABI existed. */
describe("decodeRevert", () => {
  it("decodes the reverts a bare ABI could not", () => {
    expect(decodeRevert("0xb4a9a604" + toBytes32("google").slice(2))).toMatchObject({
      name: "invalidDomain",
    });
    expect(decodeRevert("0xd1cc1202")).toMatchObject({ name: "invalidSignature", args: [] });
    expect(decodeRevert("0xda472023")).toBeUndefined(); // truncated args: not decodable
    expect(decodeRevert("0x00000000")).toBeUndefined();
  });
});

describe("explainRevert", () => {
  const wrap = (data: `0x${string}`) =>
    new BaseError("reverted", {
      cause: new ContractFunctionRevertedError({ abi: parseAbi(["function f()"]), data, functionName: "f" }),
    });

  it("names the rule that failed and what to change", () => {
    const domain = encodeErrorResult({
      abi: MultipassAbi,
      errorName: "invalidDomain",
      args: [toBytes32("google")],
    });
    expect(explainRevert(wrap(domain))).toBe(
      'invalidDomain: domain "google" is not initialised on Multipass — run script/InitDomains.s.sol for it'
    );

    const signature = encodeErrorResult({ abi: MultipassAbi, errorName: "invalidSignature" });
    expect(explainRevert(wrap(signature))).toContain(
      "the key this service signs with is not the domain's registrar"
    );

    const nonce = encodeErrorResult({
      abi: MultipassAbi,
      errorName: "invalidNonceIncrement",
      args: [2n, 1n],
    });
    expect(explainRevert(wrap(nonce))).toBe(
      "invalidNonceIncrement: nonce must increase: on chain 2, signed 1"
    );
  });

  it("falls back to the first line when there is no revert data", () => {
    expect(explainRevert(new Error("fetch failed\nstack here"))).toBe("fetch failed");
    expect(explainRevert("not an error")).toBe("not an error");
  });

  it("finds revert data in a message when the cause is not a viem error", () => {
    const data = encodeErrorResult({ abi: MultipassAbi, errorName: "invalidSignature" });
    expect(explainRevert(new Error(`execution reverted ${data}`))).toContain("invalidSignature");
  });
});

describe("every rule this service can break explains itself", () => {
  const wrapped = (data: `0x${string}`) =>
    new BaseError("reverted", {
      cause: new ContractFunctionRevertedError({ abi: parseAbi(["function f()"]), data, functionName: "f" }),
    });
  const who = "0x1111111111111111111111111111111111111111" as const;

  // One case per error a user can actually hit, because a bare selector tells them nothing.
  const cases: [string, readonly unknown[], string][] = [
    ["domainNotActive", [toBytes32("google")], "is not active"],
    ["invalidRegistrar", [who], "is not the registrar"],
    // A record and a query are whole structs on chain; the hint ignores them and says what to do.
    [
      "recordExists",
      [
        {
          wallet: who,
          name: toBytes32("alice"),
          id: toBytes32("1"),
          nonce: 1n,
          domainName: toBytes32("x.com"),
          validUntil: 0n,
          payload: `0x${"00".repeat(32)}`,
        },
      ],
      "renewal, not a registration",
    ],
    ["invalidNonce", [3n], "nonce 3"],
    ["signatureExpired", [1700000000n], "expired at 1700000000"],
    ["paymentTooLow", [1000n, 10n], "fee is 1000 wei and 10 was sent"],
    ["walletMismatch", [who, who], "belongs to"],
    ["idMismatch", [toBytes32("1"), toBytes32("2")], "does not match the one on chain"],
    [
      "userNotFound",
      [
        {
          domainName: toBytes32("x.com"),
          wallet: who,
          name: toBytes32("alice"),
          id: toBytes32("1"),
          targetDomain: toBytes32(""),
        },
      ],
      "no record to renew",
    ],
    ["nameExists", [toBytes32("alice")], '"alice" is taken'],
  ];

  it.each(cases)("says what %s means", (errorName, args, phrase) => {
    const data = encodeErrorResult({ abi: MultipassAbi, errorName, args: args.length ? args : undefined });
    const said = explainRevert(wrapped(data));
    expect(said).toContain(errorName);
    expect(said).toContain(phrase);
  });

  it("names the caller when a contract refuses an owner-only call", () => {
    const data = encodeErrorResult({
      abi: parseAbi(["error OwnableUnauthorizedAccount(address)"]),
      errorName: "OwnableUnauthorizedAccount",
      args: [who],
    });
    expect(explainRevert(wrapped(data))).toContain("does not own the contract it called");
  });

  it("falls back to the raw argument when a name is not readable text", () => {
    // A masked name is a one-time pad, so it stays hex rather than being shown as mojibake.
    const masked = `0x${"9f".repeat(32)}` as const;
    const data = encodeErrorResult({ abi: MultipassAbi, errorName: "nameExists", args: [masked] });
    expect(explainRevert(wrapped(data))).toContain(masked);
  });
});

describe("an error from a contract this build has no ABI for", () => {
  it("still says what to do about it", () => {
    // Met against the live ENSv2 resolver: role checks fail with a selector nothing here can decode.
    const err = new BaseError("reverted", {
      cause: new ContractFunctionRevertedError({
        abi: parseAbi(["function f()"]),
        data: "0x4b27a133",
        functionName: "f",
      }),
    });
    expect(explainRevert(err)).toContain("no role for that key");
    expect(explainRevert(err)).toContain("avatar");
  });
});
