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
cast call 0x4a1817d13E9cF196f471725176355c1234b63c70 \
  "resolve(bytes,bytes)(bytes,address)" \
  0x0770656572736b79086b6574737562616e0365746800 \
  $(cast calldata "addr(bytes32)" $(cast namehash peersky.ketsuban.eth)) \
  --rpc-url $RPC
# -> 0x…d70b5e8a232bf67f64658cbddebe32e1443894a0, and the resolver that answered
```

An empty `0x…20` `0x…00` answer is an empty string, not an error: that record simply has no value on
that name. Answers live on the subject name (`<you>.kju-is.<root>`), not on the root name.
