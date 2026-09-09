import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eciesDecrypt, eciesEncrypt } from "../src/ecies.js";
import {
  checkAudience,
  checkDisclosure,
  discloseDomain,
  hashBox,
  recoverDiscloseSigner,
  signDisclosure,
  type Disclosure,
} from "../src/disclose.js";
import { intentDomain } from "../src/intent.js";

const MULTIPASS = "0x418F82fd0014a4CA402F145978bfaF0555a9cA06";
const alice = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000000000a11c");
const bob = privateKeyToAccount("0x000000000000000000000000000000000000000000000000000000000000b0bb");
/** Stands in for the enclave: only this key can open a disclosure. */
const ENCLAVE_KEY = "0x000000000000000000000000000000000000000000000000000000000000ee00" as const;
const enclave = privateKeyToAccount(ENCLAVE_KEY);
const NOW = 1_800_000_000;

const box = eciesEncrypt(enclave.publicKey, new Uint8Array(32).fill(7), new Uint8Array(32).fill(9));
const base: Disclosure = {
  name: "alice.ketsuban.eth",
  domain: "x",
  audience: zeroAddress,
  exp: BigInt(NOW + 3600),
  boxHash: hashBox(box),
};

describe("disclosure grants", () => {
  it("travels to the enclave and nowhere else", () => {
    // Whoever holds the grant cannot read it; the enclave key can.
    // Any other key fails the box's own integrity check rather than returning something plausible.
    const BOB_KEY = "0x000000000000000000000000000000000000000000000000000000000000b0bb" as const;
    expect(() => eciesDecrypt(BOB_KEY, box)).toThrow(/ecies/);
    expect(eciesDecrypt(ENCLAVE_KEY, box)).toEqual(new Uint8Array(32).fill(7));
  });

  it("cannot be replayed as an intent, and binds to one ciphertext", async () => {
    const signature = await signDisclosure(alice, base, discloseDomain(11155111, MULTIPASS));
    expect(await recoverDiscloseSigner(base, signature, discloseDomain(11155111, MULTIPASS))).toBe(
      alice.address
    );
    expect(await recoverDiscloseSigner(base, signature, intentDomain(11155111, MULTIPASS))).not.toBe(
      alice.address
    );

    const other = eciesEncrypt(enclave.publicKey, new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
    expect(() =>
      checkDisclosure(
        { ...base, box: other, signature },
        { holder: alice.address, now: NOW, signer: alice.address }
      )
    ).toThrow("signature is for a different box");
  });

  it("accepts only a live grant from the record's own wallet, addressed to the reader", async () => {
    const signature = await signDisclosure(alice, base, discloseDomain(11155111, MULTIPASS));
    const grant = { ...base, box, signature };
    const ok = { holder: alice.address, now: NOW, signer: alice.address };
    expect(() => checkDisclosure(grant, ok)).not.toThrow();

    expect(() => checkDisclosure(grant, { ...ok, signer: bob.address })).toThrow(
      "not signed by the wallet that holds the record"
    );
    expect(() => checkDisclosure(grant, { ...ok, now: NOW + 7200 })).toThrow("expired");

    // An open grant opens for anyone; one addressed to a wallet opens only for that wallet, and not
    // for a caller who names nobody.
    expect(() => checkAudience(grant)).not.toThrow();
    expect(() => checkAudience(grant, bob.address)).not.toThrow();
    const toBob = { ...grant, audience: bob.address };
    expect(() => checkAudience(toBob, bob.address)).not.toThrow();
    expect(() => checkAudience(toBob, alice.address)).toThrow("addressed to a different reader");
    expect(() => checkAudience(toBob)).toThrow("addressed to a different reader");
  });
});
