# ketsuban web

Next.js client (template: the noolog web app — same shell, tokens, Dockerfile and test setup). Talks to `apps/api`;
identity is Privy (embedded wallet, identity token); the view-code key stays on the device.

| Route | Who | What |
|---|---|---|
| `/` | everyone | Three doors: candidate, voucher, verifier; a returning user gets a dashboard/continue strip. |
| `/claim` | candidate | Claim `<handle>.<root>`, answer each subject instance (`kju-is` …), get the share line and next steps. Resumes at the first unanswered subject; `?renew=<domain>` republishes one record under the held handle. |
| `/p/<handle>` | verifier / agent | Reads the whole candidate in one call (`GET /v1/profile/:handle`). The reference page: identity, answers, linked accounts, humanity, graded by a policy (`?answers=&minLinks=&humanity=1`), with the raw names to resolve yourself. |
| `/verify` | verifier | Policy presets (hiring, landlord, DAO, open) or custom → `/p/<handle>?…&preset=`. |
| `/vouch` | voucher | Candidate lookup; checks the name is live before continuing. |
| `/vouch/<handle>` | voucher | Three labelled steps, each saying what happens and why (`vouchSteps`): sign in → prove one real person (pending partner access) → write and sign as `<you>.<handle>.<root>`, then optionally a long-form letter (an ENS `description` record the voucher signs themselves). Needs the candidate's invite link (`?invite=`), which only their wallet can sign. Attesting the accounts you worked from is onboarding on `/me`, not part of vouching: a voucher with none is sent there and resumes here afterwards. A name of the voucher's own is not required; a held one is reused as the label, otherwise claiming it is the CTA after publishing. |
| `/me` | candidate / voucher | Four numbered groups, one subject each: your name, your answers, your accounts (connect and attest on the same row, labelled by handle or address), references (received, invite link, given with update and withdraw). "Needs attention" lists records expiring within 7 days. Everything that is plumbing — gas, ENS profile records, your own `.eth` alias, view-code disclosure links, the raw record list — is under one "Advanced" fold. |
| `/v/<name>` | anyone | One name's verification card, server-rendered (`generateMetadata` for unfurls). `?viewCode=0x…&links=x` discloses opted-in links. Both this and `/p/<handle>` cross-check the name through the ENSv2 UniversalResolver (`EnsProof`). |
| `/api/health` | ops | Readiness probe for the container HEALTHCHECK. |

`AttestFlow` is the single publishing component — it checks handle availability as you type (`GET /v1/name/:domain/:handle`)
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
