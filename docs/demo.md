# Demo: a reference nobody can delete

Everything here runs against the live Sepolia deployment and needs nothing but `curl`. Names resolve
through ENSv2, so the last section checks them without touching this project's code at all.

| Piece | Address |
|---|---|
| Multipass | `0x418F82fd0014a4CA402F145978bfaF0555a9cA06` |
| AttestationFactory | `0xc0281d75974155fE8513F623de726F040c4bcC51` |
| AttestationBridge | `0xC7283bD9Aad1B08947C841536946Ce4dA9c99929` |
| AttestationReporter (Chainlink CRE) | `0x4888d736a196c49CAf404FD626eB9CBbf175b140` |
| KeystoneForwarder | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` |
| ENSv2 UniversalResolver | `0x4a1817d13E9cF196f471725176355c1234b63c70` |

`API` below is the deployed relay, `alice` a candidate who has already been through the flow.

```bash
API=https://ketsuban-api.peeramid.xyz
```

## 0. Is the deployment wired correctly

```bash
curl -s $API/v1/preflight | jq '{ok, warnings}'
```

Contracts have code, the deployed bridge has the functions this build calls, every name and platform
domain is initialised and active, and the key the attester signs with is the registrar Multipass
expects. Anything false here would otherwise fail *after* a user signs.

## 1. What a verifier reads

```bash
curl -s $API/v1/profile/alice | jq '{names: [.names[] | {instance, name, answer: .verification.answer}], standing}'
curl -s $API/v1/vouches/alice | jq '.vouches[] | {voucher, statement, live, standing}'
```

One call carries every instance name, the references written for the candidate, and each voucher's
standing. No score and no grade: the API states facts, and the policy belongs to whoever is reading.

## 2. The same thing, without us

`/v1/ens` needs `UNIVERSAL_RESOLVER` set on the deployment; without it the endpoint answers 501 and the
`cast` call below still works, since it never touches this service.

```bash
curl -s $API/v1/ens/alice.ketsuban.eth | jq '{resolver, addr, answer: .texts["ketsuban:answer"]}'
```

That endpoint reads through the ENSv2 UniversalResolver. Anyone can do the same with `cast` and never
speak to this service:

```bash
cast call 0x4a1817d13E9cF196f471725176355c1234b63c70 \
  "resolve(bytes,bytes)(bytes,address)" \
  $(cast --to-dns-name alice.ketsuban.eth) \
  $(cast calldata "text(bytes32,string)" $(cast namehash alice.ketsuban.eth) "ketsuban:answer") \
  --rpc-url $SEPOLIA_RPC
```

A reference is `<voucher>.<candidate>.<root>`, so the same call works for `bob.alice.ketsuban.eth`.

An attested account is a name too. Each platform has its own instance under the root, so a public
handle resolves on its own:

```bash
cast call 0x4a1817d13E9cF196f471725176355c1234b63c70 \
  "resolve(bytes,bytes)(bytes,address)" \
  $(cast --to-dns-name alice.x.ketsuban.eth) \
  $(cast calldata "addr(bytes32)" $(cast namehash alice.x.ketsuban.eth)) --rpc-url $SEPOLIA_RPC
```

A masked account has no readable label, so there is no name to offer: the record still proves the
person controls an account on that platform, without saying which.

## 3. The other direction

A verifier who has only an address asks what it is called. The answer comes from the Multipass record
through the instance resolver, so no reverse registry is involved:

```bash
curl -s $API/v1/reverse/0xEE4811b9462956C9C3535E79c08776D769CA9F3a | jq '{name, names}'
```

```
alice.ketsuban.eth     via the root resolver
alice.x.ketsuban.eth   via the x resolver
```

## 4. Who wrote it

```bash
curl -s $API/v1/standing/bob | jq
curl -s $API/v1/wallet/0xEE4811b9462956C9C3535E79c08776D769CA9F3a | jq '{names: [.names[].ensName], given: [.given[].candidate]}'
```

A voucher's standing is their own record: how many references they gave and received. Following it is
how a verifier judges the person speaking, not just the sentence.

## 5. The browser flow

1. `/claim` — sign in, pick a name, answer each question. Four numbered groups, one subject each.
2. `/me` — connect and attest an account, create an invite link, see who has vouched.
3. `/vouch/<handle>?invite=…` — a voucher signs in, proves how they know the candidate, writes a few
   words and, if they want, a letter.
4. `/p/<handle>` — the reference page, graded against the verifier's own policy, with the raw names to
   resolve independently.
5. `/w/<address>` — the same from an address rather than a handle.

Two rules the UI enforces before a wallet signs anything: only someone the candidate invited can write
a reference for them, and a domain that cannot be written disables the button with the reason.

## 6. A letter before the person

An onboarded organisation — a university, a former employer — writes a reference for a handle nobody
has claimed. The relay creates the candidate's vouch instance from that signed record, so the letter
lands with nothing else in place. `/p/<handle>` then shows the letters waiting and invites whoever owns
that handle to claim it:

```bash
curl -s -H "x-org-token: $ORG_TOKEN" -H 'content-type: application/json' \
  -d '{"wallet":"0x…","label":"acme-university"}' $API/v1/org | jq
```

## 7. Opening a private account for one verifier

A private account proves control without naming the account. When the candidate wants one verifier to
read it, they sign a permission from their profile: the view code travels encrypted to the registrar's
public key, which lives in the enclave, so the answer is given there and the handle is never published.

```bash
curl -s $API/v1/enclave-key | jq            # what a candidate encrypts to
curl -s "$API/v1/disclose/alice.ketsuban.eth/x" | jq
```

The link the candidate hands over is `/v/alice.ketsuban.eth?reveal=x`. Without a live permission the
same page says so instead of showing anything.

## 8. What a withdrawal looks like

A voucher can withdraw. The record stays, the old statement stays in the history, and the live
statement becomes `withdrawn`, which stops counting towards a verifier's minimum and reads as
"withdrawn by the voucher" on the page. Nothing disappears.

## 9. Chainlink CRE

`packages/cre` holds one workflow with two triggers: an HTTP trigger whose handler runs inside a Nitro
enclave and signs the record as registrar, and an EVM log trigger on `Registered` that provisions a
candidate's vouch instance from what the chain says. With `reporter` configured, the nodes sign the
payload and the KeystoneForwarder delivers it to `AttestationReporter`, which writes the record — no
key of ours in that path.

```bash
cd packages/cre && cre workflow simulate attest --target staging-settings \
  --non-interactive --trigger-index 0 --http-payload ./attest/fixtures/request.json
```

## What this is not

Ketsuban attests that accountable humans stood behind a claim. It is not identity, employment, safety,
nationality or affiliation verification, and it never labels a person.
