# Ketsuban

[![ci](https://github.com/lamtrinh259/ETHGlobal_Online_2026/actions/workflows/ci.yml/badge.svg)](https://github.com/lamtrinh259/ETHGlobal_Online_2026/actions/workflows/ci.yml)

Non-deletable, human-verified references. A reference is a Multipass record whose registrar signature is produced
inside a Chainlink CRE enclave from a Privy identity token and a wallet-signed intent; ENSv2 makes every record a
name (`<handle>.<instance>.eth`) that any wallet or agent can resolve without integrating with us.

Any subject can be an instance — a question, a university cohort, an organisation. The subject is a deployment
argument, never a source artifact.

Start with [docs/demo.md](docs/demo.md): the live Sepolia deployment, checkable with `curl` and with
`cast` against the ENSv2 UniversalResolver. [docs/namespace.md](docs/namespace.md) explains what every
name means and why a platform is mounted at its own DNS name, and
[docs/troubleshooting.md](docs/troubleshooting.md) is what to read when something is wrong.

Four claims worth checking, each without asking this service:

| Claim | How to check it |
|---|---|
| A platform is the DNS name it is | `demo.com.x.www.ketsuban.eth` resolves; `nobody.com.x.www.ketsuban.eth` and `foo.demo.com.x.www.ketsuban.eth` do not |
| A private account is named after the person, never itself | `<name>.com.discord.private-www.ketsuban.eth` answers only while both records are live, and says nothing about which account |
| Profile fields are role-gated on chain | `setText(avatar)` from the holder is allowed; the same key from anyone else, and any other key from the holder, is refused by the resolver |
| The signature is made in an enclave | `pnpm --filter @ketsuban/cre-attest simulate:dns` signs a record for `x.com` inside the TEE simulator |

The app's own [/names](https://ketsuban.peeramid.xyz/names) page builds the same list from the mounts on
chain, so it never drifts from what is deployed.

## Checks

The packages generate what the apps import — the registrar's types, and the errors ABI the contracts dump
— so `pnpm --filter "./packages/**" run build` comes first in a fresh checkout. It is not an install hook
on purpose: the container build installs before it copies any source, and a hook there fails with nothing
to compile.

`pnpm -w lint && pnpm -w typecheck && pnpm -w test` is the gate: every package runs its own tests, with
coverage thresholds where the language has them. `pnpm --filter @ketsuban/api test:e2e` is the slow one —
anvil, the contracts deployed from this source, and the API image, driven from outside. Both run on every
push through `.github/workflows/ci.yml`, and the e2e needs no secrets: the identity issuer is faked from a
seed.

## Packages

| Package | What |
|---|---|
| `packages/registrar` | `@ketsuban/registrar` — pure attester: `(idToken, intent, signature, secrets) → { record, signature, viewCode? }`. Runs unchanged inside the CRE enclave and in the Node fallback. |
| `packages/contracts` | Foundry. `AttestationFactory` deploys one `AttestationRegistry` (ENSv2 `IRegistry` over a Multipass domain) + `AttestationResolver` (ENSIP-10 shim) per instance; `AttestationBridge` proxies registration, grants profile keys, links owned `.eth` names, and lets orgs sponsor. |
| `packages/cre` | Chainlink CRE workflow: HTTP trigger → public checks + chain read on the DON → `handlerInTee` signs as registrar. |
| `apps/api` | Relay: receives enclave output, submits through the bridge, serves the machine-readable verification endpoint. |

## Flow

```mermaid
sequenceDiagram
  participant B as Browser (Privy)
  participant C as CRE (DON + enclave)
  participant A as api
  participant M as Multipass
  participant E as ENSv2
  B->>B: login, link account, sign EIP-712 Intent
  B->>C: { idToken, intent, signature }
  C->>M: resolveRecord(wallet, domain)
  C->>C: verify token + intent, derive record, sign as registrar (enclave)
  C->>A: { record, signature, viewCode? }
  A->>M: AttestationBridge.verify / verifyFor
  E-->>B: <handle>.<instance>.eth resolves (addr, ketsuban:answer, ketsuban:link:*, ketsuban:humanity)
```

## Develop

```bash
pnpm install
pnpm -r test                       # registrar (vitest) + contracts (forge)
cd packages/contracts && forge coverage --report summary --no-match-coverage "^(test|vendor|node_modules)/"
```

Sepolia dependencies: Multipass `0x418F82fd0014a4CA402F145978bfaF0555a9cA06`, ENSv2 addresses from
[docs.ens.domains/learn/deployments](https://docs.ens.domains/learn/deployments/).

Environment variables are listed in `.env.example`; never commit `.env`.

## Sepolia deployment

| | |
|---|---|
| Root name | `ketsuban.eth` → `AttestationRegistry` `0x254D9c7601BD8fa6b6FA7f5A42c860d184E053A7`, resolver `0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e` |
| Child instance | `kju-is.ketsuban.eth` → registry `0xA976CB21597c555F92e7A5de2dAAF06A3c0D63F7`, resolver `0x24d0F1dc28D9d05342C2c2ceA459C3f0Dffb18D8` |
| Factory / Bridge | `0xc0281d75974155fE8513F623de726F040c4bcC51` / `0xC7283bD9Aad1B08947C841536946Ce4dA9c99929` |
| Stock PermissionedResolver | `0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7` (Verifiable Factory proxy) |

```bash
# any ENSv2 client, no integration with us
cast call 0x4a1817d13e9cf196f471725176355c1234b63c70 "resolve(bytes,bytes)(bytes,address)" \
  $(python3 -c "print('0x'+b'\x06alice\x08ketsuban\x03eth\x00'.hex())") \
  $(cast calldata "text(bytes32,string)" $(cast namehash alice.ketsuban.eth) "ketsuban:answer") --rpc-url sepolia
```

Artifact: `packages/contracts/deployments/11155111.json`. Runbook: `docs/deploy.md`.

## Resolver keys

| Key | Source |
|---|---|
| `addr`, reverse `name` | live Multipass record in the instance domain |
| `text ketsuban:answer`, `text ketsuban:expiry` | record `payload`, `validUntil` |
| `text ketsuban:humanity[:until]` | wallet-keyed hop into the `humanity` domain |
| `data ketsuban:link:<domain>` | wallet-keyed hop → `abi.encodePacked(name, id, payload)`; `payload != 0` ⇒ opted-in, decode with the view code |
| everything else | stock ENSv2 `PermissionedResolver` (user text records, oracle `data` keys, aliases) |

## License

MIT
