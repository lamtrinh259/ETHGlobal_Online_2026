# api

Relay and verification service. One container, env-configured, health-checked on `/healthz`.

| Route | Purpose |
|---|---|
| `POST /v1/cre/delivery` | CRE external delivery: `{ record, signature, viewCode? }` → `AttestationBridge.verify` → `{ ok, txHash }`. Guarded by `x-delivery-token` when `DELIVERY_TOKEN` is set. |
| `POST /v1/attest` | Node registrar fallback (same input/output as the enclave). Enabled only when `REGISTRAR_KEY` and `VIEWCODE_KEY` are set. |
| `GET /v1/verify/:name` | Machine-readable verification read through the ENS resolver: status, wallet, answer, expiry, humanity, links (`?links=x,telegram`, `?viewCode=` to disclose opted-in links), `profile` (the user's `avatar`/`description`/`url`/`email` text records on the stock resolver), evidence, warning. |
| `GET /v1/instances` | Instances known to the factory, plus `bridge` and `permissionedResolver` addresses for direct wallet writes. |

CORS: `CORS_ORIGINS` (comma list, default `*`) — set it to the web app origin in production.
| `GET /v1/nonce?wallet=&domain=` | On-chain state for a wallet in a domain; `next` is the nonce to sign into the intent. |
| `GET /v1/name/:domain/:handle` | Is the handle free in that domain; holder wallet and liveness. |
| `GET /v1/wallet/:address` | A wallet's names, linked-account records and references given (its dashboard). |
| `GET /v1/vouches/:handle` | Every reference written under the candidate: records in the `~<handle>` vouch domain (Registered/Renewed logs from `DEPLOY_BLOCK`, current state per id, liveness). |

Vouch instances: when a delivery registers a record in the root name domain (`NAME_DOMAINS[0]`), the relay provisions
`~<handle>` — Multipass domain (fee 0, registrar `REGISTRAR_ADDRESS`) → `AttestationFactory.create` → root
`setSubregistry(handle)` — so `bob.alice.<root>` is a real ENS name. Needs `REGISTRY`, `PERMISSIONED_RESOLVER`
(from `DEPLOYMENT_FILE`) and `REGISTRAR_ADDRESS`; the relayer must own Multipass, the factory and the root registry.

## Configuration

See `src/config.ts`. Addresses come from env or from a forge deployment artifact via `DEPLOYMENT_FILE`.

## Deploy (Coolify)

`docker-compose.yml` is the production compose: dedicated project `ketsuban-api`, named network `ketsuban_api`, no host
ports (the proxy reaches `expose`d 8787), every setting from the project environment.

## Tests

```bash
pnpm test        # unit, fake chain
pnpm test:e2e    # docker: anvil + DeployLocal.s.sol + api image, full loop from the host
```

The e2e stack is project `ketsuban-e2e` on network `ketsuban_e2e` (`E2E_SUBNET`, default `10.211.7.0/24`) with loopback-only
ports `E2E_ANVIL_PORT` (18545) and `E2E_API_PORT` (18787), so it never collides with other compose projects on the
same machine.
