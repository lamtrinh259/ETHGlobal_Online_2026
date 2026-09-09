import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { checkDisclosure, eciesDecrypt, recoverDiscloseSigner, discloseDomain } from "@ketsuban/registrar";
import {
  boxHashOf,
  buildDisclosure,
  disclosureTypedData,
  revealLink,
  toDisclosureWire,
} from "@/lib/disclose";

const MULTIPASS = "0x418F82fd0014a4CA402F145978bfaF0555a9cA06";
const ENCLAVE_KEY = "0x000000000000000000000000000000000000000000000000000000000000ee00" as const;
const enclave = privateKeyToAccount(ENCLAVE_KEY);
const alice = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000000000a11c");
const VIEW_CODE = `0x${"5a".repeat(32)}` as const;
const NOW = 1_800_000_000;

describe("building a disclosure", () => {
  it("encrypts the view code to the enclave, and the signature the registrar checks recovers to the candidate", async () => {
    const { disclosure, box } = buildDisclosure({
      name: "alice.ketsuban.eth",
      domain: "x",
      viewCode: VIEW_CODE,
      enclavePubkey: enclave.publicKey,
      now: NOW,
    });
    // Only the enclave key opens it, and it carries exactly the view code.
    expect(eciesDecrypt(ENCLAVE_KEY, box)).toEqual(Uint8Array.from(Buffer.from(VIEW_CODE.slice(2), "hex")));
    expect(disclosure.boxHash).toBe(boxHashOf(box));

    const td = disclosureTypedData(disclosure, 11155111, MULTIPASS);
    expect(() => JSON.stringify(td)).not.toThrow();
    expect(td.message.exp).toBe(String(NOW + 30 * 86400));

    const signature = await alice.signTypedData(td as never);
    const wire = toDisclosureWire(disclosure, box, signature);
    expect(wire.exp).toBe(String(disclosure.exp));

    expect(await recoverDiscloseSigner(disclosure, signature, discloseDomain(11155111, MULTIPASS))).toBe(
      alice.address
    );
    expect(() =>
      checkDisclosure(
        { ...disclosure, box, signature },
        { holder: alice.address, now: NOW, signer: alice.address }
      )
    ).not.toThrow();
  });

  it("does not produce the same bytes twice for one view code", () => {
    const args = {
      name: "alice.ketsuban.eth",
      domain: "x",
      viewCode: VIEW_CODE,
      enclavePubkey: enclave.publicKey,
      now: NOW,
    };
    const a = buildDisclosure(args);
    const b = buildDisclosure(args);
    expect(a.box.ciphertext).not.toBe(b.box.ciphertext);
    expect(a.disclosure.boxHash).not.toBe(b.disclosure.boxHash);
  });

  it("hands over a link that opens one account on the card", () => {
    expect(revealLink("https://app.example/", "alice.ketsuban.eth", "x")).toBe(
      "https://app.example/v/alice.ketsuban.eth?reveal=x"
    );
  });
});
