# When something is wrong

Every symptom here was met on the live deployment. Each one has a first thing to read rather than a guess.

## Read this first

```bash
curl -s $API/healthz | jq .config      # every address this process is using, and which secrets are set
curl -s $API/v1/preflight | jq         # what those addresses actually are on chain
```

`healthz` says what the service *believes*; `preflight` says what the chain *holds*. Most problems are one
of the two disagreeing with the other.

## The app says a record cannot be written

`invalidDomain` — the Multipass domain was never initialised. Preflight lists every domain this deployment
may be asked for; an uninitialised one is a warning there long before a person signs anything.

`invalidSignature` — the key this service signs with is not that domain's registrar. `preflight.registrar`
shows both: `signsAs` is the configured key, `onchain` is what the domains expect. They must match.

`recordExists` — a record already exists for that id, so it is a renewal rather than a registration. The
relay routes those itself; seeing it means something called `register` directly.

## The ENS profile card refuses to save

The resolver refuses a key the wallet holds no role for. The bridge grants exactly `avatar`,
`description`, `url` and `email`, to the wallet a name lands on, and nothing else — see
[the namespace](namespace.md). A wallet on the wrong network fails differently: the app now asks it to
switch and says which chain to pick.

## An account shows as "not attested" though it exists

The record is probably in the flat domain (`google`) while the page is looking at the DNS one
(`google.com`), or the other way round. The row checks both, and offers to give an unnamed record a name by
attesting it again in the DNS domain.

## A name resolves to the wrong person, or to somebody who never attested

That was a real bug: the Universal Resolver falls back to the nearest ancestor resolver, so an instance
that answers on the first label alone becomes a wildcard for everything beneath it. Every fallback ends at
the resolver the `.eth` registry names, and `script/SetRootResolver.s.sol` replaces that one in a single
transaction. Check with a name that must **not** resolve:

```bash
curl -s $API/v1/ens/alice.anything.ketsuban.eth | jq .address   # 0x0, always
```

## Two factories

A deployment can carry two: the one that made the root instance, the flat platforms and every vouch
instance, and a later one carrying the DNS namespace. Both are read for mounts. A candidate's vouch
instance must be created in the **bridge's** factory, because the bridge grants a voucher the roles for
their letter by asking its own factory — an instance it cannot see gets no grant, and the letter reverts.

## The index is missing old records

`DEPLOY_BLOCK` is later than the block a record was written in. Names in the root domain are read straight
from the chain so a person's own page is right regardless, but references and account listings come from
the index. Lower it and restart; the snapshot in `DATA_DIR` resumes from where it left off.

## A test hangs on Linux but passes locally

Never stand in for "unwritable" with a path under `/proc`: `mkdir` there never returns on Linux. Use a
directory beneath a regular file, which fails with `ENOTDIR` immediately everywhere.

## Writing a letter answers 507

The letter store is full. Nothing gates `/v1/letter` — a reference can be written by anyone, so the
letter behind it can be too — which means the store needs a ceiling or a stranger could fill the disk
and take the grants and avatars down with it. Raise `LETTER_STORE_BYTES` (default 25MB) or free space.

Letters already held keep working: the ceiling refuses new writes, it never drops old ones.

## Uploading a picture answers 503, and shares vanish after a restart

Both are the same fault: `DATA_DIR` is set but the service cannot write there — a path with no volume
behind it, or one owned by another user. Writes to the grant store fail the same way, and because that
failure only meant a log line, everything looked fine until the next restart.

The service now says so in three places:

```bash
# at boot, in the container log
storage · DATA_DIR (/data) cannot be written · EACCES: permission denied · nothing kept here survives a restart

curl -s $API/healthz | jq .config.storage      # { "durable": true, "writable": false, "lastError": "…" }
curl -s $API/v1/preflight | jq .warnings       # the same, where the app shows it
```

Mount a volume at `DATA_DIR` and make sure the container's user can write to it. Until then, an upload
answers 503 naming the directory, rather than a 500 naming nothing.

## The humanity badge never changes

Read the two answers in that order:

```bash
curl -s $API/healthz | jq '.config.world, .config.secrets.worldSigningKey'
curl -s -XPOST $API/v1/humanity/challenge -H 'content-type: application/json' -d '{"wallet":"0x…"}' | jq
```

`world: null` means the deployment has no World ID app configured, which is the intended off state: the
CTA is disabled and nothing else changes. Configured, the challenge answers a signed `rp_context`; if
the widget then opens and World refuses the request, the signing key is not the one that app registered.

Past the proof, the write is the ordinary one and fails the ordinary ways. 409 means that nullifier is
already bound to another account — one human, one account, and the binding lives in `DATA_DIR` so it
survives a redeploy. 422 carries World's own reason (`all_verifications_failed`, `already_verified`).
503 naming the registrar means the `humanity` domain does not name this service, exactly as for any
other domain; `curl -s $API/v1/preflight | jq .multipass.domains` says so before anyone signs anything.

A verified person whose badge is still grey is a resolution problem, not a World one: the record is
keyed by the wallet, so `ketsuban:humanity` only answers on a name that same wallet holds.

## The picture on my profile is gone, or will not upload

Pictures are kept under `DATA_DIR` and served back at `/v1/avatar/<hash>.<ext>`, because an ENS text
record holds a URL rather than bytes. Without `DATA_DIR` the upload is refused outright: a picture that
does not outlive a restart would leave the record pointing at nothing.

What is stored is decided by the file's own bytes, not by its name or its declared type, so a document
renamed to `.png` is refused with 415. The cap is 2MB.

## A share I made is gone after a redeploy

Grants live wherever `DATA_DIR` points. With it unset they are held in memory, so restarting the
service — any redeploy — drops every permission anyone granted, silently. `GET /healthz` says which
you have:

```json
{ "config": { "storage": { "dataDir": null, "durable": false } } }
```

`durable: false` means set `DATA_DIR` to a mounted path and redeploy.

A grant written by an older build is dropped rather than revived: its shape is not one this build can
read, and reviving it anyway put an unusable row in the list that took every other share down with it.
Re-share the account and the new grant persists normally.

## "Read it yourself, through ENS" says the name could not be read

The page turns any failure of `/v1/ens/<name>` into nothing at all, so the card cannot tell an
unconfigured resolver from a read that did not come back. Check which it is:

```bash
curl -s $API/healthz | jq .config.universalResolver   # null means unconfigured
curl -s "$API/v1/ens/peersky.ketsuban.eth" | jq       # 501 unconfigured, 502 the RPC did not answer
```

The Sepolia UniversalResolver ships with the bundled deployment, so `null` here usually means the API
is running an older image or a chain id with no bundle.

The command the card prints is meant to be run as it stands. Note that `cast` has **no** DNS encoder —
there is no `--to-dns-name` — so the wire-format name is written into the command literally:

```bash
cast call 0x4A1817d13E9cF196f471725176355C1234b63C70 \
  "resolve(bytes,bytes)(bytes,address)" \
  0x0770656572736b79086b6574737562616e0365746800 \
  $(cast calldata "addr(bytes32)" $(cast namehash peersky.ketsuban.eth)) \
  --rpc-url $RPC
# -> 0x…d70b5e8a232bf67f64658cbddebe32e1443894a0, and the resolver that answered
```

An empty `0x…20` `0x…00` answer is an empty string, not an error: that record simply has no value on
that name. Answers live on the subject name (`<you>.kju-is.<root>`), not on the root name.

## Does a World ID proof stop one person holding two accounts?

Not provably, yet — and the product must not claim it until it does.

The attester stores each nullifier and refuses a second wallet that presents the same one, which stops
a proof being replayed. Whether that stops *a person* opening two accounts depends on a question World's
own documentation answers twice, differently:

- `world-id/idkit/integrate`: "The same person verifying the same action always produces the same
  nullifier."
- `world-id/4-0-migration`: "In 4.0, nullifiers are one-time-use, and `session_id` is the stable link."

If the second governs a v4 uniqueness proof, two fresh proofs from one person yield two nullifiers and
the dedupe never fires. Two things bound that risk today: session proofs are refused outright (they
carry no per-action nullifier), and the widget asks for legacy proofs (`allow_legacy_proofs`), which do
carry the stable per-action nullifier.

Until this is confirmed with World, treat a humanity record as *a verified human proved this at a point
in time* — which it is — and not as one-account-per-person. The copy says only the former.
