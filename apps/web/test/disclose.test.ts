import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  checkDisclosure,
  discloseDomain,
  eciesDecrypt,
  hashBoxes,
  linkKeyHash,
  recoverDiscloseSigner,
} from "@ketsuban/registrar";
import {
  boxHashOf,
  buildDisclosure,
  disclosureTypedData,
  linkKeyFromInvite,
  newLinkKey,
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

  /**
   * A grant addressed to nobody binds nobody, so the link is the whole permission — and it named a
   * public name and a public account, both of which anybody can guess. Shared that way an account was
   * not shared, it was published, under a page promising "anyone holding this link".
   */
  it("carries the secret in a link for whoever holds it, in the fragment", () => {
    const key = newLinkKey();
    const link = revealLink("https://app.example", "alice.ketsuban.eth", "x.com", undefined, key);
    expect(link).toBe(`https://app.example/v/alice.ketsuban.eth?reveal=x.com#k=${key}`);
    // The fragment is the half a browser keeps: it reaches no server log and no referrer header.
    expect(new URL(link).search).not.toContain(key);
  });

  it("mints a secret worth calling one", () => {
    const keys = new Set(Array.from({ length: 64 }, () => newLinkKey()));
    expect(keys.size).toBe(64);
    for (const k of keys) expect(k).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("hands the attester the hash of that secret, never the secret", () => {
    const key = newLinkKey();
    const { disclosure, boxes } = buildDisclosure({
      name: "alice.ketsuban.eth",
      accounts: [{ domain: "x.com", viewCode: VIEW_CODE }],
      enclavePubkey: enclave.publicKey,
      now: NOW,
    });
    const wire = toDisclosureWire(disclosure, boxes, "0xdead", key);
    expect(wire.linkKeyHash).toBe(linkKeyHash(key));
    expect(JSON.stringify(wire)).not.toContain(key.slice(2));
    // A grant addressed to one reader opens for that reader, and needs no secret at all.
    expect(toDisclosureWire(disclosure, boxes, "0xdead")).not.toHaveProperty("linkKeyHash");
  });
});

/**
 * A grant that rides along with an invitation.
 *
 * The candidate opens their private accounts to the writer they are inviting, so that writer is not
 * asked to vouch for somebody half visible. It is addressed to nobody, because the invitation is
 * already the permission — so its secret has to be the invitation's own code, which lives in the link
 * the writer followed and nowhere else.
 */
describe("the key an invitation carries", () => {
  it("is derived from the code, so both ends reach it without sending it", () => {
    expect(linkKeyFromInvite("abc123")).toBe(linkKeyFromInvite("ABC123"));
    expect(linkKeyFromInvite("abc123")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("differs for every invitation, so one does not open another", () => {
    const keys = new Set(["a", "b", "c", "d"].map(linkKeyFromInvite));
    expect(keys.size).toBe(4);
  });

  it("is not the code itself, which is what makes the derivation worth doing", () => {
    const code = "0".repeat(32);
    expect(linkKeyFromInvite(code)).not.toContain(code);
  });
});
