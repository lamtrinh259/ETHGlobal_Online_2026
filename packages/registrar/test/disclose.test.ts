import { describe, expect, it } from "vitest";
import { zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { eciesDecrypt, eciesEncrypt } from "../src/ecies.js";
import {
  checkAudience,
  checkDisclosure,
  discloseDomain,
  domainsKey,
  hashBoxes,
  checkRevocation,
  recoverDiscloseSigner,
  recoverRevokeSigner,
  REVOKE_WINDOW,
  signDisclosure,
  signRevocation,
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
const box2 = eciesEncrypt(enclave.publicKey, new Uint8Array(32).fill(8), new Uint8Array(32).fill(6));
const base: Disclosure = {
  name: "alice.ketsuban.eth",
  domains: ["x"],
  audience: zeroAddress,
  audienceName: "",
  exp: BigInt(NOW + 3600),
  boxesHash: hashBoxes([box]),
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
        { ...base, boxes: [other], signature },
        { holder: alice.address, now: NOW, signer: alice.address }
      )
    ).toThrow("signature is for a different box");
  });

  it("accepts only a live grant from the record's own wallet, addressed to the reader", async () => {
    const signature = await signDisclosure(alice, base, discloseDomain(11155111, MULTIPASS));
    const grant = { ...base, boxes: [box], signature };
    const ok = { holder: alice.address, now: NOW, signer: alice.address };
    expect(() => checkDisclosure(grant, ok)).not.toThrow();

    expect(() => checkDisclosure(grant, { ...ok, signer: bob.address })).toThrow(
      "not signed by the wallet that holds the record"
    );
    expect(() => checkDisclosure(grant, { ...ok, now: NOW + 7200 })).toThrow("expired");

    // An open grant opens for anyone; one addressed to a wallet opens only for that wallet, and not
    // for a caller who names nobody.
    expect(() => checkAudience(grant)).not.toThrow();
    expect(() => checkAudience(grant, { reader: bob.address })).not.toThrow();
    const toBob = { ...grant, audience: bob.address };
    expect(() => checkAudience(toBob, { reader: bob.address })).not.toThrow();
    expect(() => checkAudience(toBob, { reader: alice.address })).toThrow("addressed to a different reader");
    expect(() => checkAudience(toBob)).toThrow("addressed to a different reader");
  });
});

describe("revoking a grant", () => {
  const revocation = { name: base.name, grantId: base.boxesHash, at: BigInt(NOW) };
  const domain = discloseDomain(11155111, MULTIPASS);

  it("only the wallet that holds the record can take a grant back", async () => {
    const signature = await signRevocation(alice, revocation, domain);
    const signer = await recoverRevokeSigner(revocation, signature, domain);
    expect(signer).toBe(alice.address);
    expect(() => checkRevocation(revocation, { holder: alice.address, now: NOW, signer })).not.toThrow();
    // Bob signing a revocation for Alice's record is the attack this check exists for.
    expect(() =>
      checkRevocation(revocation, { holder: alice.address, now: NOW, signer: bob.address })
    ).toThrow(/holds the record/);
  });

  it("is fresh or it is nothing, so an old one cannot kill a grant made since", () => {
    const signer = alice.address;
    const holder = alice.address;
    // Re-sharing after a revocation must not be undone by replaying the revocation that preceded it.
    expect(() => checkRevocation(revocation, { holder, now: NOW + REVOKE_WINDOW + 1, signer })).toThrow(
      /too old/
    );
    expect(() => checkRevocation(revocation, { holder, now: NOW + REVOKE_WINDOW - 1, signer })).not.toThrow();
    // Nor may one be dated into the future to keep it usable indefinitely.
    expect(() => checkRevocation(revocation, { holder, now: NOW - REVOKE_WINDOW - 1, signer })).toThrow(
      /future/
    );
  });

  it("cannot be replayed as a grant: the two are different statements", async () => {
    const signature = await signRevocation(alice, revocation, domain);
    // Same domain, same fields where they overlap — a disclosure signature must not verify here.
    const asGrant = await signDisclosure(alice, base, domain);
    expect(await recoverRevokeSigner(revocation, asGrant, domain)).not.toBe(alice.address);
    expect(await recoverDiscloseSigner(base, signature, domain)).not.toBe(alice.address);
  });
});

describe("one grant, several accounts", () => {
  const many: Disclosure = {
    name: "alice.ketsuban.eth",
    // Sharing three accounts must not cost three signatures: the reader is given one link either way.
    domains: ["discord.com", "x"],
    audience: zeroAddress,
    audienceName: "",
    exp: BigInt(NOW + 3600),
    boxesHash: hashBoxes([box, box2]),
  };
  const domain = discloseDomain(11155111, MULTIPASS);

  it("binds to every ciphertext it carries, in the order it names them", async () => {
    const signature = await signDisclosure(alice, many, domain);
    const ok = { holder: alice.address, now: NOW, signer: alice.address };
    expect(() => checkDisclosure({ ...many, boxes: [box, box2], signature }, ok)).not.toThrow();

    // Swapping two boxes would hand a reader the wrong account's view code under the right name.
    expect(() => checkDisclosure({ ...many, boxes: [box2, box], signature }, ok)).toThrow(/different box/);
    // And dropping one must not silently narrow the grant to whatever is left.
    expect(() => checkDisclosure({ ...many, boxes: [box], signature }, ok)).toThrow(/different box/);
  });

  it("keeps each account's own view code, because one code never opens another account", () => {
    expect(eciesDecrypt(ENCLAVE_KEY, box)).toEqual(new Uint8Array(32).fill(7));
    expect(eciesDecrypt(ENCLAVE_KEY, box2)).toEqual(new Uint8Array(32).fill(8));
  });

  it("names its accounts in one order, so the same selection is the same grant", () => {
    // The signature covers the list as given; sorting it first is what makes two identical selections
    // produce the same statement rather than two that differ only by click order.
    expect(domainsKey(["x", "discord.com"])).toEqual(["discord.com", "x"]);
    expect(domainsKey(["x", "x"])).toEqual(["x"]);
  });
});

describe("addressing a grant to a name instead of a wallet", () => {
  const under = (audienceName: string): SignedDisclosure => ({
    name: "alice.ketsuban.eth",
    domains: ["x"],
    audience: zeroAddress,
    audienceName,
    exp: BigInt(NOW + 3600),
    boxesHash: hashBoxes([box]),
    boxes: [box],
    signature: "0xdeadbeef",
  });

  it("opens for anyone holding a name in the branch, and for nobody outside it", () => {
    // The point of the wildcard: "whoever at acme.com" is a group the holder cannot enumerate, and
    // ENSv2 resolves every name under the branch without any of them being registered one by one.
    const grant = under("*.com.acme.www.ketsuban.eth");
    expect(() =>
      checkAudience(grant, { reader: bob.address, readerName: "bob.com.acme.www.ketsuban.eth" })
    ).not.toThrow();
    // A name that merely ends in the same words but sits in another branch is a different company.
    expect(() =>
      checkAudience(grant, { reader: bob.address, readerName: "bob.com.evil-acme.www.ketsuban.eth" })
    ).toThrow(/different reader/);
    // The branch itself is not a name under it: `*.` requires at least one label.
    expect(() =>
      checkAudience(grant, { reader: bob.address, readerName: "com.acme.www.ketsuban.eth" })
    ).toThrow(/different reader/);
    // And a reader who names nothing gets nothing, however good their wallet.
    expect(() => checkAudience(grant, { reader: bob.address })).toThrow(/different reader/);
  });

  it("addresses one person by name, so a wallet change does not lock them out", () => {
    const grant = under("bob.ketsuban.eth");
    expect(() => checkAudience(grant, { reader: bob.address, readerName: "bob.ketsuban.eth" })).not.toThrow();
    expect(() => checkAudience(grant, { reader: bob.address, readerName: "carol.ketsuban.eth" })).toThrow(
      /different reader/
    );
    // Case is not identity: ENS names are compared lowercased.
    expect(() => checkAudience(grant, { reader: bob.address, readerName: "BOB.ketsuban.eth" })).not.toThrow();
  });

  it("still addresses a wallet when no name is named, and still opens for anyone when neither is", () => {
    const toWallet: SignedDisclosure = { ...under(""), audience: bob.address };
    expect(() => checkAudience(toWallet, { reader: bob.address })).not.toThrow();
    expect(() => checkAudience(toWallet, { reader: alice.address })).toThrow(/different reader/);
    expect(() => checkAudience(under(""), {})).not.toThrow();
  });
});
