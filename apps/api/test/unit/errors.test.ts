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
