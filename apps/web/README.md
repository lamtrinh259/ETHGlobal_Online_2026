# ketsuban web

Next.js client (template: the noolog web app — same shell, tokens, Dockerfile and test setup). Talks to `apps/api`;
identity is Privy (embedded wallet, identity token); the view-code key stays on the device.

| Route | Who | What |
|---|---|---|
| `/` | everyone | Three doors: candidate, voucher, verifier. |
| `/claim` | candidate | Claim `<handle>.<root>`, answer each subject instance (`kju-is` …), get the share line. |
| `/p/<handle>` | verifier / agent | The reference page: identity, answers, linked accounts, humanity, graded by a policy (`?answers=&minLinks=&humanity=1`), with the raw names to resolve yourself. |
| `/verify` | verifier | Policy picker → `/p/<handle>`. |
| `/vouch/<handle>` | voucher | Sign in → humanity (pending partner access) → link work account → claim own name → statement (per-candidate vouch instances land next). |
| `/v/<name>` | anyone | One name's verification card, server-rendered (`generateMetadata` for unfurls). `?viewCode=0x…&links=x` discloses opted-in links. |
| `/api/health` | ops | Readiness probe for the container HEALTHCHECK. |

`AttestFlow` is the single publishing component; journeys pass `fixedDomain` / `fixedHandle` / `onPublished` to
sequence it. `lib/profile.ts` folds per-name verifications into the page and grades the policy (pure, tested).

`lib/` is the pure part (config, intent builder, API client, react-query hooks, browser view key) — unit-tested;
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
