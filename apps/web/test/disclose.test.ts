import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  checkDisclosure,
  discloseDomain,
  eciesDecrypt,
  hashBoxes,
  recoverDiscloseSigner,
} from "@ketsuban/registrar";
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
    const { disclosure, boxes } = buildDisclosure({
      name: "alice.ketsuban.eth",
      accounts: [{ domain: "x", viewCode: VIEW_CODE }],
      enclavePubkey: enclave.publicKey,
      now: NOW,
    });
    // Only the enclave key opens it, and it carries exactly the view code.
    expect(eciesDecrypt(ENCLAVE_KEY, boxes[0])).toEqual(
      Uint8Array.from(Buffer.from(VIEW_CODE.slice(2), "hex"))
    );
    // The hash covers the sequence of boxes, not one box: a single account is a list of one.
    expect(disclosure.boxesHash).toBe(hashBoxes(boxes));
    expect(disclosure.boxesHash).not.toBe(boxHashOf(boxes[0]));

    const td = disclosureTypedData(disclosure, 11155111, MULTIPASS);
    expect(() => JSON.stringify(td)).not.toThrow();
    expect(td.message.exp).toBe(String(NOW + 30 * 86400));

    const signature = await alice.signTypedData(td as never);
    const wire = toDisclosureWire(disclosure, boxes, signature);
    expect(wire.exp).toBe(String(disclosure.exp));

    expect(await recoverDiscloseSigner(disclosure, signature, discloseDomain(11155111, MULTIPASS))).toBe(
      alice.address
    );
    expect(() =>
      checkDisclosure(
        { ...disclosure, boxes, signature },
        { holder: alice.address, now: NOW, signer: alice.address }
      )
    ).not.toThrow();
  });

  it("does not produce the same bytes twice for one view code", () => {
    const args = {
      name: "alice.ketsuban.eth",
      accounts: [{ domain: "x", viewCode: VIEW_CODE }],
      enclavePubkey: enclave.publicKey,
      now: NOW,
    };
    const a = buildDisclosure(args);
    const b = buildDisclosure(args);
    expect(a.boxes[0].ciphertext).not.toBe(b.boxes[0].ciphertext);
    expect(a.disclosure.boxesHash).not.toBe(b.disclosure.boxesHash);
  });

  it("covers every account picked with one signature, in one order", async () => {
    // Two accounts, two view codes, one statement: the reader is handed one link either way, so the
    // holder is asked once. Click order must not change what was signed.
    const codes = [
      { domain: "x", viewCode: VIEW_CODE },
      { domain: "discord.com", viewCode: `0x${"7b".repeat(32)}` as const },
    ];
    const { disclosure, boxes } = buildDisclosure({
      name: "alice.ketsuban.eth",
      accounts: codes,
      enclavePubkey: enclave.publicKey,
      now: NOW,
    });
    expect(disclosure.domains).toEqual(["discord.com", "x"]);
    // Each box holds its own account's code, matched by position to the names above.
    expect(eciesDecrypt(ENCLAVE_KEY, boxes[0])).toEqual(
      Uint8Array.from(Buffer.from(codes[1].viewCode.slice(2), "hex"))
    );
    expect(eciesDecrypt(ENCLAVE_KEY, boxes[1])).toEqual(
      Uint8Array.from(Buffer.from(VIEW_CODE.slice(2), "hex"))
    );

    const signature = await alice.signTypedData(
      disclosureTypedData(disclosure, 11155111, MULTIPASS) as never
    );
    expect(() =>
      checkDisclosure(
        { ...disclosure, boxes, signature },
        { holder: alice.address, now: NOW, signer: alice.address }
      )
    ).not.toThrow();

    const reversed = buildDisclosure({
      name: "alice.ketsuban.eth",
      accounts: [...codes].reverse(),
      enclavePubkey: enclave.publicKey,
      now: NOW,
    });
    expect(reversed.disclosure.domains).toEqual(disclosure.domains);
  });

  it("hands over one link that opens every account it was given", () => {
    expect(revealLink("https://app.example/", "alice.ketsuban.eth", "x")).toBe(
      "https://app.example/v/alice.ketsuban.eth?reveal=x"
    );
    expect(revealLink("https://app.example", "alice.ketsuban.eth", ["discord.com", "x"])).toBe(
      "https://app.example/v/alice.ketsuban.eth?reveal=discord.com%2Cx"
    );
    // An addressed link carries the wallet it is for, so the page can say who has to be signed in.
    expect(revealLink("https://app.example", "alice.ketsuban.eth", "x.com", "0xabc")).toBe(
      "https://app.example/v/alice.ketsuban.eth?reveal=x.com&for=0xabc"
    );
  });
});
