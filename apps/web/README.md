# ketsuban web

Next.js client (template: the noolog web app — same shell, tokens, Dockerfile and test setup). Talks to `apps/api`;
identity is Privy (embedded wallet, identity token); the view-code key stays on the device.

| Route | Who | What |
|---|---|---|
| `/` | everyone | The search, which is what everybody arrives to do: one field taking a name, a handle or a wallet address, with the domain it belongs to as a chip beside it. Under it, most referenced first — the subjects among them, because a subject is something people here have written about. |
| `/claim` | — | Redirects to `/me`. Claiming was a second screen that knew half the candidate's state. |
| `/p/<handle>` | verifier / agent | A person, read in one call (`GET /v1/profile/:handle`). States their records — score, answers, accounts, references received and given, and below them the shape behind the count (who stands behind them, whether those people know each other) and what the references say (each statement read once by the Noolog fast council, summed into one line, every reading behind a fold and marked provisional) — and grades nobody until a reader applies a policy, which the bar on the page does (`?preset=` or `?answers=&minLinks=&minVouches=&humanity=1`). An unheld name says so and offers the two things there are to do with it. A read that failed says that instead, rather than rendering as a person with nothing. |
| `/employers` | verifier | The same reading, asked of everybody under consideration at once: a bar, a shortlist kept in the reader's own browser, and where each of them stands against it. Somebody known only by an account nobody holds a name for is invited instead: a signed invitation kept by the attester (`POST /v1/invite`, `kind: "policy"`), worded for the person, linking to `/me?invite=<code>`, and listed under "Whom you invited" as a pending check until they have a page. See [docs/employers.md](../../docs/employers.md). |
| `/w/<address>` | verifier | What one wallet holds: live names, attested accounts (masked or public), and the references it wrote. Leads with who holds it, since that is the question an address is pasted to ask. Ungraded on purpose; an address carries no policy. |
| `/vouch/<handle>` | voucher | Three labelled steps, each saying what happens and why (`vouchSteps`): sign in → prove one real person (done once on `/me`) → write and sign as `<you>.<handle>.<root>`, then optionally a long-form letter (an ENS `description` record the voucher signs themselves). Needs the candidate's invite link (`?invite=`), which only their wallet can sign — except for a wallet that already wrote there, or an onboarded organisation, which issues letters uninvited. Attesting the accounts you worked from is onboarding on `/me`, not part of vouching: a voucher with none is sent there and resumes here afterwards. A name of the voucher's own is not required; a held one is reused as the label, otherwise claiming it is the CTA after publishing. |
| `/me` | candidate / voucher | Everything a person does, in order: prove you are one real person (World ID, when the deployment has an app configured; the badge and its CTA sit beside the name), attest the accounts you signed in with, claim your name, answer each question, collect references. Claiming and answering open a dialog. An onboarded organisation is told so first. "Needs attention" lists records expiring within 7 days. Plumbing — gas, ENS profile records, your own `.eth` alias, view-code disclosure links, the raw record list — is under one "Advanced" fold. `?invite=<code>` carrying an employer's invitation is answered first: who is asking, what they require, and which account to begin with — then, once the page exists, a link to read it against their bar. |
| `/v/<name>` | anyone | Every name that is not a person: an account, a reference, a mount, a subject. A person's own name is sent to `/p/<handle>` by `middleware.ts`, as a real redirect, so a crawler follows it too. `?reveal=<platform>` opens one private account when the candidate signed a permission for it — a permission made for whoever holds the link carries its secret in the fragment (`#k=…`), never in the query. `#viewCode=0x…&links=x` opens an opted-in link for a reader the candidate handed a view code to. Cross-checks the name through the ENSv2 UniversalResolver (`EnsProof`). |
| `/trust` | anyone | Where each step runs and what it can see, the key the chain trusts, the records this deployment has actually written, and what it says is wrong with itself. |
| `/api/health` | ops | Readiness probe for the container HEALTHCHECK; also reports `sha` and `builtAt`, the same pair the footer shows. |

The profile ends with "How you appear on chain": every name anyone can read (your name, each public
account, each answer), why a private account has none, and the reverse answer — what a client asking
about your address gets, read from the Multipass record rather than a reverse registry.

A record reaches the chain before it reaches the index, so after publishing the profile polls until the
record appears and says it is waiting. Nothing offers the same action twice while that is true.

Attesting an account happens in a `Modal`: signing is a decision that interrupts, not a section of the
page. Privacy is a `Switch`, on by default, worded as what it does — you decide who can read your handle.
`Step` is the shared numbered group used by the profile and the claim journey. `AttestFlow` disables publishing when `GET /v1/nonce` reports the domain cannot be written (not
initialised, not active, or this attester is not its registrar) and shows that reason, so nobody signs
into a revert. `AttestFlow` is the single publishing component — it checks handle availability as you type (`GET /v1/name/:domain/:handle`)
and turns into "Sign & update" when the wallet already holds a record (the newer nonce supersedes the old one); journeys pass `fixedDomain` / `fixedHandle` / `onPublished` to
sequence it. `lib/profile.ts` folds per-name verifications into the page and grades the policy; `lib/journey.ts` derives
journey progress from the wallet dashboard (both pure, tested).

The shell is a left sidebar on a wide screen and the same markup as a full-screen drawer under 900px
(the pattern, the breakpoint and the focus/inert handling come from the noolog web app): the closed
drawer is `inert`, Escape and a route change close it, and the page behind it leaves the tab order.

`lib/` is the pure part (config, intent builder, API client, react-query hooks, browser view key, `chain.ts` wallet writes, `identity.ts` display name) — unit-tested;
`app/` holds the shell (`AppShell`, `ThemeToggle`) and the two screens. Privy hooks live only in `app/AttestFlow.tsx`.

## Develop

```bash
pnpm install                         # from the repo root (workspace: @ketsuban/registrar)
cp .env.example .env.local           # public identifiers only
pnpm dev                             # http://localhost:3000, expects the API on NEXT_PUBLIC_API_URL
```

## Test

```bash
pnpm test        # vitest — config, intent, keys, api client, hooks, VerifyCard, shell helpers
pnpm test:e2e    # playwright — shell, theme, health, verify/not-found (prod build on :8099; API mocked/unreachable)
```

First run: `npx playwright install chromium`.

## Deploy (Coolify)

Application (Git) → Build Pack **Dockerfile**, Base Directory **`/`**, Dockerfile Location `/apps/web/Dockerfile`,
Port `3000`, health `/api/health`. `NEXT_PUBLIC_*` are inlined at build time — set them in the Coolify environment
before the first build and rebuild when they change. Add the domain to Privy's allowed origins and the API's CORS.

## Notes

- **Providers render client-only** (after mount) so react-query and Privy never run during SSR; `/v/<name>` is a
  server component that does not use them.
- **Storage throws on access** in private mode / over quota: every `localStorage` read and write is wrapped, and the
  theme is applied before it is persisted.
- **The view code is encrypted to a browser key, not the wallet** — embedded wallets never expose their private key.
  Losing the browser key means re-attesting; the registrar derives the same view code for the same account.
- **Nonce comes from the API** (`/v1/nonce`) and is invalidated after every delivery so a renewal signs the next one.
