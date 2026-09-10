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
