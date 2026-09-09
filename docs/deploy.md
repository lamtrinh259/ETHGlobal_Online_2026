# Deploy

All services share one physical host with other stacks. Rules that keep them apart:

- every compose file sets `name:` (`ketsuban-*`) and a dedicated named network (`ketsuban_*`);
- production composes publish **no host ports** — Coolify's proxy reaches `expose`d ports on the project network;
- e2e stacks publish on `127.0.0.1` only, high ports (`18545`, `18787`), and pin their own subnet (`10.211.7.0/24`)
  so they never overlap the default bridge (`10.200.0.0/24`) or other projects' `172.18–20/16` ranges;
- every setting is an environment variable; nothing host-specific is committed.

## 1. Contracts (Sepolia)

Prerequisites: `PRIVATE_KEY` funded on Sepolia; Multipass domains initialised by the Multipass owner
(`InitDomains.s.sol`, signer supplied with `--mnemonics … --mnemonic-indexes <owner>` so no owner key is ever in env):

```bash
MULTIPASS=0x418F82fd0014a4CA402F145978bfaF0555a9cA06 REGISTRAR=<registrar address> \
DOMAINS=ketsuban,kju-is,x,telegram,humanity,org \
forge script script/InitDomains.s.sol --rpc-url sepolia --mnemonics "$ETH_SEPOLIA_MNEMONIC" --mnemonic-indexes 1 --broadcast
```

```bash
cd packages/contracts
export PRIVATE_KEY=… ETH_SEPOLIA_RPC_URL=… ETHERSCAN_V2_KEY=…
export MULTIPASS=0x418F82fd0014a4CA402F145978bfaF0555a9cA06
export ETH_REGISTRY=0xbdc85dd5b15d7ecb354cd7cb6f2c50b4f2c4f0e2
export VERIFIABLE_FACTORY=0x10dc6333cdfe1fcef624c6e0a8221b91804cd7ef
export PERMISSIONED_RESOLVER_IMPL=0x9eae5c2730a7dd16bdd1dee6421a1b91e3b0365e
export ROOT_DOMAIN=ketsuban ROOT_LABEL=ketsuban CHILD_DOMAIN=kju-is CHILD_LABEL=kju-is
forge script script/DeploySepolia.s.sol --rpc-url sepolia --broadcast
```

Deploys the stock PermissionedResolver (Verifiable Factory), factory, bridge, the root instance (`*.ketsuban.eth`) and a
child instance nested under it (`*.kju-is.ketsuban.eth`); writes `deployments/11155111.json`.

Mount the root name on the ETHRegistrar (`0xa88553f454b77203b0d036a05c894d555eaaa2cc`) with the mock payment token
(MockUSDC `0x768f42455a2d082e23ceef7d51e5787c82d67a39`, `mint(address,uint256)` is open on Sepolia):

```bash
export ETH_REGISTRAR=0xa88553f454b77203b0d036a05c894d555eaaa2cc PAYMENT_TOKEN=0x768f42455a2d082e23ceef7d51e5787c82d67a39
export REGISTRY=<deployments.registry> RESOLVER=<deployments.resolver> SECRET=0x<32 random bytes>
STEP=commit   forge script script/MountRoot.s.sol --rpc-url sepolia --broadcast
sleep 70
STEP=register forge script script/MountRoot.s.sol --rpc-url sepolia --broadcast
```

Oracle keys (once): `PermissionedResolver.authorizeDataRoles(encode(""), "ketsuban:<key>", ORACLE, true)` for
`polarity`, `conviction`, `rank`.

Current Sepolia deployment: `packages/contracts/deployments/11155111.json` (committed); sources verified on Etherscan
and Sourcify.

ENSv2 Sepolia addresses: [docs.ens.domains/learn/deployments](https://docs.ens.domains/learn/deployments/).

## 2. CRE workflow (`packages/cre`)

```bash
cre login                                  # browser
cd packages/cre && cp .env.example .env    # CRE_ETH_PRIVATE_KEY, SECRET_REGISTRAR_KEY, SECRET_VIEWCODE_KEY
# simulation (no deploy access needed)
cre workflow simulate attest --target staging-settings --non-interactive --trigger-index 0 --http-payload ./attest/fixtures/request.json
# deployment (needs deploy access + Confidential Workflows beta)
cre secrets create --target production-settings   # uploads secrets.yaml names from .env to the Vault DON
cre workflow deploy attest --target production-settings
cre workflow activate attest --target production-settings
```

`attest/config.production.json`: set `authorizedKeys` to the API's signer address, `deliveryUrl` to
`https://<api-host>/v1/cre/delivery`, `nameDomains` to the instance domains. Secrets never go in config.

## 3. API (`apps/api`) — Coolify

Coolify → project → **New resource → Application (Git)** → repository `ETHGlobal_Online_2026`, branch `feat/scaffold`:

| Setting | Value |
|---|---|
| Build Pack | **Dockerfile** |
| Base Directory | **`/`** — the image copies `packages/registrar` and the workspace lockfile; a base dir of `apps/api` makes every `COPY` fail with `"/packages/registrar": not found` |
| Dockerfile Location | `/apps/api/Dockerfile` |
| Port | `8787` — Coolify sets `PORT` from this value and the image's HEALTHCHECK follows `$PORT`, so any port works as long as the proxy target matches |
| Health | `/healthz` (the image declares a HEALTHCHECK; enable zero-downtime) |

`apps/api/docker-compose.yml` is the alternative (Docker Compose build pack, base directory `/`, compose path
`apps/api/docker-compose.yml`) if a dedicated network name is wanted.

Environment (Coolify project → Environment Variables) — copy `apps/api/.env.coolify.example`, it carries the current
Sepolia addresses and placeholders for the secrets:

| Variable | Value |
|---|---|
| `RPC_URL`, `CHAIN_ID` | Sepolia RPC, `11155111` |
| `MULTIPASS`, `BRIDGE`, `FACTORY` | from `deployments/11155111.json` |
| `RELAYER_KEY` | funded relayer EOA (Privy server wallet later) |
| `PRIVY_APP_ID`, `PRIVY_VERIFICATION_KEY_JWK` | app id, P-256 JWK from the JWKS endpoint |
| `NAME_DOMAINS` | comma-separated instance domains |
| `DELIVERY_TOKEN` | ≥16 chars, same value in the CRE delivery header |
| `REGISTRAR_KEY`, `VIEWCODE_KEY` | only for the Node fallback; unset when the enclave signs |
| `REGISTRY`, `PERMISSIONED_RESOLVER`, `REGISTRAR_ADDRESS`, `DEPLOY_BLOCK` | vouch-instance provisioning (relayer must own Multipass, factory, root registry); `VOUCH_PREFIX` defaults to `~` |
| `CORS_ORIGINS` | the web app origin |

Health: `GET /healthz`. No volumes, no ports, stateless — scale by replicas.

## 4. Web (`apps/web`) — Coolify

Same shape as the API: Application (Git), Build Pack **Dockerfile**, Base Directory **`/`**, Dockerfile Location
`/apps/web/Dockerfile`, Port `3000`, health `/api/health`. `NEXT_PUBLIC_*` are inlined at build time — set them in the
Coolify environment **before** the first build and rebuild when they change (`apps/web/.env.example` lists them; all
public). Add the web domain to the Privy dashboard's allowed origins and to the API's CORS allow-list.

## 5. Verify a deployment

```bash
curl -s https://<api-host>/healthz
curl -s https://<api-host>/v1/instances
curl -s https://<api-host>/v1/verify/<handle>.<instance>.eth
```

## Chainlink CRE write path

The workflow writes the record itself: the nodes sign the payload and the KeystoneForwarder calls
`AttestationReporter.onReport`, which hands it to the bridge. The reporter holds no privileges, so it
can be added to a live deployment without moving a single role.

| Chain | KeystoneForwarder | AttestationReporter |
|---|---|---|
| Ethereum Sepolia | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0x4888d736a196c49CAf404FD626eB9CBbf175b140` |

```bash
cd packages/contracts
MULTIPASS=0x418F82fd0014a4CA402F145978bfaF0555a9cA06 \
BRIDGE=0xC7283bD9Aad1B08947C841536946Ce4dA9c99929 \
CRE_FORWARDER=0xF8344CFd5c43616a4366C34E3EEE75af79a74482 \
PRIVATE_KEY=$OPERATOR_KEY \
forge script script/DeployReporter.s.sol --rpc-url $SEPOLIA_RPC --broadcast --verify
```

The reporter routes by itself: a first record goes through `AttestationBridge.verify`, which also grants
the wallet its profile keys, and a renewal goes straight to `Multipass.renewRecord`, which needs no
privileges. That is why it works against a bridge deployed before any of this existed. Then put the address in
`packages/cre/attest/config.*.json` as `reporter`. Fund the reporter only if a
served domain charges a fee: a report cannot carry value, so `onReport` pays from its own balance.
Every domain on the current deployment has a zero fee.

### Platform domains must exist before anyone links an account

Multipass reverts with `invalidDomain` on a domain that was never initialised, and the user only finds
out after signing. Every platform the attester may be asked for needs one:

```bash
cd packages/contracts
MULTIPASS=0x418F82fd0014a4CA402F145978bfaF0555a9cA06 \
REGISTRAR=0x8583AD4a0F59Ba45C7E201318C6F774F31f7bbC8 \
DOMAINS=x,telegram,discord,github,google,linkedin,email \
forge script script/InitDomains.s.sol --rpc-url $SEPOLIA_RPC --private-key $OPERATOR_KEY --broadcast
```

The script is idempotent and `GET /v1/preflight` lists every domain with its `initialised`, `active`
and `registrar` state, so this is visible before a user hits it.

### Known limitation on this deployment

The stock `PermissionedResolver`'s root roles still sit with the original deployer address
(`0x6cF8d74c7875De8C2FFb09228F4bf2A21b25E583`), whose key was in the `.env.swp` leak and has been
rotated out of use. That address can still grant itself `ROLE_SET_TEXT` and `ROLE_SET_ALIAS` on names
under this deployment, so text records and aliases here are not safe against whoever holds that key.
Multipass ownership and the registrar are on the current operator, so records themselves cannot be
forged. Fixing it means a fresh resolver proxy and fresh instances, which changes every instance
address; until then treat this deployment as a demo.
