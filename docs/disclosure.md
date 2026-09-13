# View codes and disclosure

A private account is on chain as a masked name and a commitment. The view code is what opens it, and
who may use it is the holder's decision, one reader at a time.

## Where a view code comes from

It is derived, never stored: `deriveViewCode(VIEWCODE_KEY, domain, platform account id)` inside the
attester. The same account in the same domain always gives the same code, so there is no per-person
secret for anyone to lose, and the attester keeps no table of them.

```mermaid
flowchart TD
  K["VIEWCODE_KEY · the attester's secret"] --> D["deriveViewCode(key, domain, account id)"]
  D --> V["the view code · 32 bytes, nowhere stored"]
  V --> C["on chain: the masked name, and a commitment to this code"]
  V --> E["at attestation: encrypted to the browser's own key"]
  V --> S["later: POST /v1/viewcodes re-derives it for the signed-in person, on any device"]
  V --> G["a grant: encrypted to the registrar's key, signed by the holder"]
  G --> R1["a reader the holder named: one wallet, one name, or a whole branch"]
  G --> R2["whoever holds the link: the link carries the secret"]
```

The browser keeps its own keypair (`apps/web/lib/keys.ts`) because an embedded wallet never exposes a
private key; losing it costs nothing, since `POST /v1/viewcodes` derives the codes again from the
Privy identity token and the wallets that session holds. A code somebody *gave* this person is the one
thing that cannot be re-derived, so `POST /v1/viewcodes/given` keeps it against their Privy user.

## Opening one account for one reader

The holder signs a `Ketsuban Disclosure` over the ciphertext hash, the domains, an audience and an
expiry. The view code inside it is encrypted to the registrar's public key, which lives in the
enclave, so storing the grant gives the relay nothing: only the enclave can open the box, and the
handle is never written to disk or to chain. `GET /v1/disclose/:name/:domain` is where a reader asks.

The audience is one of four: a wallet, a name (`bob.shibboleth.eth`), a branch
(`*.com.acme.www.shibboleth.eth` — whoever holds a name under `acme.com`, which the holder could not
enumerate), or nobody in particular, which is the link below. A reader's name is resolved on chain
before it counts; a claim is never evidence. `GET /v1/disclosures/:name` is the holder's own list, and
`POST /v1/revoke` takes one back.

## The link secret

A grant addressed to one reader opens for that reader: the attester checks the wallet, or the name
they hold, against what the holder signed.

A grant made for *whoever holds the link* is addressed to the zero address, so it binds nobody — the
link is the whole permission. It used to be
`/v/<their public name>?reveal=<the account>`, both halves of which anybody can guess, so an account
shared this way was not shared, it was published, while the page promised "anyone holding this link".

Such a grant now carries a secret:

```mermaid
sequenceDiagram
  participant H as holder's browser
  participant A as attester
  participant R as reader
  H->>H: k = 32 random bytes
  H->>A: POST /v1/disclose { grant, linkKeyHash: keccak(k) }
  H->>R: /v/<name>?reveal=<domain>#k=<k>
  R->>A: GET /v1/disclose/<name>/<domain>?k=<k>
  A->>A: keccak(k) == stored hash?
  A-->>R: the handle, or 403
```

- The secret is minted in the browser and never sent to the attester — only its hash is.
- It travels in the URL **fragment**, which a browser does not send to a server, so it reaches no
  access log and no referrer header.
- `GET /v1/disclosures/:name` is the holder's own list of who can read what. It returns the grant id
  and never the hash, so reading that list does not hand out the permissions it describes.
- The hash is not part of what the holder signed. It is therefore written once: re-posting the same
  grant cannot swap in a secret somebody else chose.
- Grants made before this stop opening and must be shared again. That is the point: they had no
  secret, so anybody could already read them.

### A grant that rides with an invitation

A candidate inviting somebody to refer them can open their private accounts to that writer, so the
writer is not asked to vouch for someone half visible. That grant is addressed to nobody, because the
invitation is already the permission — and its secret is therefore the invitation's own code:

```
linkKey = keccak256("ketsuban:invite:" + code)
```

Both ends derive it, so nothing extra is sent and the writer carries one link rather than two. The
invitation's code is 128 bits, which is what makes this worth deriving from.

The writer sees what was opened on the referral page itself: the list of a name's grants is public —
it names domains and expiry, never a handle — so the page can tell which accounts to ask about, and
opening one still takes the invitation.
