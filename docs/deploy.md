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
