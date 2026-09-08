# CRE workflow: `attest`

Confidential workflow that turns a wallet-signed intent plus a Privy identity token into a
registrar-signed Multipass record. The enclave is the registrar: the signing key and the view-code
key exist only inside it.

```
HTTP trigger { idToken, intent, signature }
  └─ handlerInTee
       ├─ usingTheDons(): Multipass.resolveRecord(wallet, domain)      public
       ├─ verifyPublicLeg: intent signature, expiry, nonce, wallet     public
       ├─ getSecret(REGISTRAR_KEY), getSecret(VIEWCODE_KEY)            enclave
       ├─ attestConfidential: verify ES256 token, derive record, sign  enclave
       └─ optional POST to deliveryUrl via the DON (identical consensus)
```

## Config (`attest/config.*.json`)

| Field | Meaning |
|---|---|
| `chainSelectorName`, `chainId`, `multipass`, `eip712` | Multipass deployment the enclave signs for |
| `privy.appId`, `privy.verificationKey` | identity-token audience and pinned P-256 JWK |
| `nameDomains` | domains whose records are `{ handle, keccak(DID), answer }` — the instance subjects |
| `secretIds` | Vault / `.env` secret IDs for the registrar and view-code keys |
| `authorizedKeys` | EVM addresses allowed to fire the trigger (empty only in simulation) |
| `deliveryUrl` | relay endpoint (`apps/api` `/v1/cre/delivery`); empty returns the result only |

## Run

```bash
cp .env.example .env                                   # simulation secrets
cd attest && pnpm install && bun test                  # unit tests with a fake TEE runtime
bun run scripts/make-fixture.ts [name]                 # fixtures/request.json + config.local.json
cd .. && cre workflow simulate attest --target local-settings --non-interactive --trigger-index 0 \
  --http-payload ./attest/fixtures/request.json
```

The simulator prints the signed record; the relay submits it. Deployment needs Confidential Workflows
beta access; simulation does not.
