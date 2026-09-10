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

A live example, written under the namespace and readable by anyone — and beside it the names that must
**not** answer, because a resolver serves its own children only:

```
demo.com.x.www.ketsuban.eth         ->  0xF0121f93b1a1bAd73AdDC316B57684bD93D3254e
                                        via the x.com resolver 0x4b3e0eaE64b843537BFE49e9344fd2eb75c97A59
nobody.com.x.www.ketsuban.eth       ->  0x0
foo.demo.com.x.www.ketsuban.eth     ->  0x0
alice.anything.ketsuban.eth         ->  0x0
```

```bash
cast call 0x4a1817d13E9cF196f471725176355c1234b63c70 \
  "resolve(bytes,bytes)(bytes,address)" \
  $(cast --to-dns-name alice.ketsuban.eth) \
  $(cast calldata "text(bytes32,string)" $(cast namehash alice.ketsuban.eth) "ketsuban:answer") \
  --rpc-url $SEPOLIA_RPC
```

A reference is `<voucher>.<candidate>.<root>`, so the same call works for `bob.alice.ketsuban.eth`.

An attested account is a name too. A platform is mounted at the DNS name it is, so a public handle
resolves on its own (see [the namespace](namespace.md)):

A live example, written under the namespace and readable by anyone — and beside it the names that must
**not** answer, because a resolver serves its own children only:

```
demo.com.x.www.ketsuban.eth         ->  0xF0121f93b1a1bAd73AdDC316B57684bD93D3254e
                                        via the x.com resolver 0x4b3e0eaE64b843537BFE49e9344fd2eb75c97A59
nobody.com.x.www.ketsuban.eth       ->  0x0
foo.demo.com.x.www.ketsuban.eth     ->  0x0
alice.anything.ketsuban.eth         ->  0x0
```

```bash
cast call 0x4a1817d13E9cF196f471725176355c1234b63c70 \
  "resolve(bytes,bytes)(bytes,address)" \
  $(cast --to-dns-name alice_x.com.x.www.ketsuban.eth) \
  $(cast calldata "addr(bytes32)" $(cast namehash alice_x.com.x.www.ketsuban.eth)) --rpc-url $SEPOLIA_RPC
```

A masked account has no readable label of its own, so the private branch names the person instead:
`alice.com.x.private-www.ketsuban.eth` says the holder of `alice.ketsuban.eth` is on X, and which
account stays behind the view code.

## 3. The other direction

A verifier who has only an address asks what it is called. The answer comes from the Multipass record
through the instance resolver, so no reverse registry is involved:

```bash
curl -s $API/v1/reverse/0xEE4811b9462956C9C3535E79c08776D769CA9F3a | jq '{name, names}'
```

```
alice.ketsuban.eth               via the root resolver
alice_x.com.x.www.ketsuban.eth   via the x.com resolver
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

Finding the person first: `/v1/who?domain=x.com&handle=bob` says who holds an account, and
`/v1/find?q=bob` lists everyone of that name with the references each has received, most first.
Nothing on chain decides which `bob` anybody means — the one people have actually vouched for is the
evidence, and it gets truer over time rather than being settled by whoever registered first.

A private account is the exception: the chain holds a one-time pad, so no search can match it. Whoever
the candidate gave a view code to can pass it as `&viewCode=0x…`, which computes the masked name and
matches exactly. Without the code the answer says a private account exists rather than "nobody",
because reporting nobody invites writing a second page for a person who already has one.

A reference is two things: a few words that live in the name itself, and a letter that cannot. A name
holds 31 bytes — not 31 characters; an accented letter costs two and an emoji four — and a text record
costs gas by the byte, so a full letter goes to the attester and only its hash goes on chain:

```bash
curl -s -XPOST $API/v1/letter -H 'content-type: application/json' \
  -d '{"text":"Alice ran infrastructure at Acme…"}' | jq   # -> { "ref": "sha256:…" }
```

The voucher writes that `sha256:…` as the `description` record on their vouch name — the same key the
bridge already grants them a role for — and a reader hashes the copy they are given and compares. The
trade is worth stating plainly: the hash is permanent, the text is only as durable as the service that
kept it. A lost letter can still be proven to have said what it said; it cannot be recovered, and the
card says so rather than showing a reference with no letter.

Referring is non-permissioned: anyone may write a reference for anyone, and the subject need not have
claimed a handle yet. A reference the candidate did not ask for is written all the same and reported
as `solicited: false`, which the card shows as an **unsolicited** badge — a note on the reference, not
a barrier to it. When the candidate did invite the writer, their signed invitation travels with the
reference so a verifier recovers the signer themselves rather than trusting this service.

A verifier who only trusts invited references says so in their own policy — `solicited=1` on the
reference link, or the checkbox on `/verify`. It is off by default: discounting the uninvited by
default would put the permission rule back in through the policy instead of the write path.

`REQUIRE_INVITE=true` restores the closed behaviour for a deployment that wants it. The UI still
disables the button, with the reason, for a domain that cannot be written.

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

One grant covers everything picked. Sharing three accounts is one decision and one link, so it is one
signature over the whole selection: the statement names its accounts in one order and carries their
view codes as boxes in the same order, each encrypted separately to the enclave.

A permission can also name a branch instead of a person: `*.com.acme.www.ketsuban.eth` opens for whoever
holds a public name under `acme.com`. That is a group the holder cannot enumerate, and ENSv2 answers for
every name in the branch without any of them being registered one by one. The reader names a name they
hold and the attester resolves it on chain — a claim is never evidence:

```bash
curl -s "$API/v1/disclose/alice.ketsuban.eth/x?reader=0x…&as=bob.com.acme.www.ketsuban.eth" | jq
```

Sharing is not one-way. The profile lists one row per share — one signature made it, one takes it back,
however many accounts it opened — and revoking names the grant:

```bash
curl -s "$API/v1/disclosures/alice.ketsuban.eth" | jq   # who can read what, right now
curl -s -XPOST $API/v1/revoke -H 'content-type: application/json' \
  -d '{"name":"alice.ketsuban.eth","grantId":"0x…","at":"1800000000","signature":"0x…"}' | jq
```

The revocation is signed by the wallet that holds the record and carries the time it was signed. The
attester refuses one older than five minutes, so a captured revocation cannot be replayed later to undo
a share made since. Once revoked, the reader gets the same answer as someone who was never given
anything: the account is masked again.

## 8. What a withdrawal looks like

A voucher can withdraw. The record stays, the old statement stays in the history, and the live
statement becomes `withdrawn`, which stops counting towards a verifier's minimum and reads as
"withdrawn by the voucher" on the page. Nothing disappears.

## 9. Chainlink CRE

`packages/cre` holds one workflow with three handlers: an HTTP trigger whose handler runs inside a Nitro
enclave and signs the record as registrar, a second whose enclave answers which account a masked record belongs to for whoever the candidate
allowed, and an EVM log trigger on `Registered` that provisions a candidate's vouch instance from what
the chain says. With `reporter` configured, the nodes sign the
payload and the KeystoneForwarder delivers it to `AttestationReporter`, which writes the record — no
key of ours in that path.

```bash
cd packages/cre && cre workflow simulate attest --target staging-settings \
  --non-interactive --trigger-index 0 --http-payload ./attest/fixtures/request.json
```

## What this is not

Ketsuban attests that accountable humans stood behind a claim. It is not identity, employment, safety,
nationality or affiliation verification, and it never labels a person.

## 5. Signed inside an enclave

The attester runs as a Chainlink CRE Confidential Workflow: the identity token, the view code and the
registrar key never leave the TEE, and what comes out is a signed record anyone can check. The simulator
runs the same binary, so the whole path is reproducible without deployment access:

```bash
pnpm --filter @ketsuban/cre-attest fixtures     # writes fixtures + config.local.json
pnpm --filter @ketsuban/cre-attest simulate     # a flat platform record
pnpm --filter @ketsuban/cre-attest simulate:dns # a record in the DNS namespace
```

The DNS run signs a record for `x.com` named `alice` — the label the account takes in
`com.x.www.ketsuban.eth`. The private run (`fixtures/dns-private.json`) signs the same account masked: the
name on chain is a one-time pad, the payload is the view-code commitment, and the view code itself comes
back encrypted to the person's key.

```
name       0x707cb09c…   the handle, masked
payload    0xa11185aa…   commitment to the view code
viewCode   {ephemeralPubkey, nonce, ciphertext}   readable only by the wallet that asked
```

Deployment needs Confidential Workflows access (`cre account access`); everything above runs without it.

## 6. Who may write which field

The profile records are standard ENS text records on the stock ENSv2 PermissionedResolver, and the roles
are per key and per name. When a name lands, the bridge grants that wallet `ROLE_SET_TEXT` for exactly
`avatar`, `description`, `url` and `email`. Nothing else is granted, and the resolver — not this service —
is what refuses the rest:

```
holder, granted key       setText(peersky.ketsuban.eth, "avatar")       allowed
holder, ungranted key     setText(peersky.ketsuban.eth, "com.twitter")  refused 0x4b27a133
a stranger, granted key   setText(peersky.ketsuban.eth, "avatar")       refused 0x4b27a133
```

Checked with `eth_call` against Sepolia, from each wallet in turn. The same three cases are asserted in
`test/AttestationBridge.t.sol`, where the write goes through and reads back, and both refusals revert.
