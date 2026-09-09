# Contributing

## Workflow

1. Tests first. Unit tests next to the package (`vitest` for TS, `bun test` for the CRE workflow, `forge test` for
   contracts); the API has a docker e2e (`pnpm --filter @ketsuban/api test:e2e`) that boots anvil, deploys
   `DeployLocal.s.sol`, builds the API image and drives the full loop from the host.
2. Coverage target 90%+ on new code (`pnpm test` prints it; `forge coverage` for contracts).
3. Docs: update the package README and `docs/` with the change.
4. Lint: `pnpm -r lint` (prettier) and `forge fmt`.
5. Commit messages: subject line, blank line, bulleted body — one `- <Verb> <Kind> <what>` per change.
   Verbs: `Added Removed Fixed Increased Decreased Improved BREAKING CHANGE`;
   Kinds: `Ability Function Bug Interface Redundancy Performance`.

## Conventions

- **The subject of an instance is a deployment argument.** No Multipass domain name, ENS parent name, resolver
  key prefix or product name may be hard-coded in `src/`. They live in config (`config.*.json`, env, forge script
  env) and in tests.
- **One attester, two hosts.** `@ketsuban/registrar` is pure and WASM-safe (no Node built-ins, no `Date.now()`, no
  randomness). The CRE handler and the API call the same functions; fixtures that prove one prove the other.
- **Determinism inside the enclave.** Anything the enclave outputs must be byte-identical across DON replicas:
  RFC-6979 signatures, seeded ECIES, `runtime.now()`.
- **Secrets stay references.** Only IDs in config; values come from `.env` (simulation) or the Vault DON.
- **Chain reads are public.** The enclave reads Multipass through `usingTheDons()`; treat the result as public.
- **Test helpers are a subpath.** `@ketsuban/registrar/testing` exports the fake Privy issuer and intent signing so
  every suite mints the same shapes.
- **Relative imports carry `.js`** in `packages/registrar` so both bundler and NodeNext consumers resolve them.

## Layout

```
packages/registrar   pure attester + testing helpers
packages/contracts   Foundry; vendor/ holds pinned ENSv2 + ens-contracts interfaces
packages/cre         CRE project (project.yaml, secrets.yaml) with the `attest` workflow
apps/api             relay + verification API, Dockerfile, docker-compose.e2e.yml
docs/                architecture and runbooks
```

## Before pushing a dependency change

`pnpm check:lockfile` fails exactly the way the Docker build does when `pnpm-lock.yaml` is behind a
`package.json`. A local install uses a warm store and happily proceeds, so this is the only cheap way
to catch it before a deploy does.
