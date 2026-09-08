# api

Relay and verification service. One container, env-configured, health-checked on `/healthz`.

| Route | Purpose |
|---|---|
| `POST /v1/cre/delivery` | CRE external delivery: `{ record, signature, viewCode? }` → `AttestationBridge.verify` → `{ ok, txHash }`. Guarded by `x-delivery-token` when `DELIVERY_TOKEN` is set. |
| `POST /v1/attest` | Node registrar fallback (same input/output as the enclave). Enabled only when `REGISTRAR_KEY` and `VIEWCODE_KEY` are set. |
| `GET /v1/verify/:name` | Machine-readable verification read through the ENS resolver: status, wallet, answer, expiry, humanity, links (`?links=x,telegram`, `?viewCode=` to disclose opted-in links), evidence, warning. |
| `GET /v1/instances` | Instances known to the factory. |

## Configuration

See `src/config.ts`. Addresses come from env or from a forge deployment artifact via `DEPLOYMENT_FILE`.

## Tests

```bash
pnpm test        # unit, fake chain
pnpm test:e2e    # docker: anvil + DeployLocal.s.sol + api image, full loop from the host
```
