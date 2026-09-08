# contracts

| Contract | Role |
|---|---|
| `AttestationFactory` | `create(domain, parent, parentLabel, parentName, inner)` → one registry + resolver per Multipass domain |
| `AttestationRegistry` | ENSv2 `IRegistry`: `getResolver(label)` is the shim iff a live record exists; `setSubregistry` nests instances |
| `AttestationResolver` | ENSIP-10 shim: `addr`, reverse `name`, `text ketsuban:answer|expiry|humanity[:until]`, `data ketsuban:link:<domain>` from Multipass; everything else forwarded to the stock `PermissionedResolver` |
| `AttestationBridge` | `verify` / `verifyFor(orgId, …)` proxy `Multipass.register` and grant the wallet four profile text keys; `linkOwnName(domain, label)` aliases `<parentLabel>.<label>.eth` for `.eth` owners; `setOrg` registers sponsoring treasuries |

`vendor/` holds pinned copies of the ENSv2 (`contracts-v2`) and `ens-contracts` interfaces we depend on; Multipass and
OpenZeppelin come from npm.

```bash
forge test
forge coverage --report summary --no-match-coverage "^(test|vendor|node_modules)/"

# local: fresh Multipass + mocks + one instance, writes deployments/local.json
PRIVATE_KEY=… REGISTRAR=… INSTANCE_DOMAIN=kju-is INSTANCE_PARENT=kju-is.eth \
forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast

# sepolia: stock PermissionedResolver via VerifiableFactory + factory + bridge + first instance
PRIVATE_KEY=… MULTIPASS=… ETH_REGISTRY=… VERIFIABLE_FACTORY=… PERMISSIONED_RESOLVER_IMPL=… \
INSTANCE_DOMAIN=… INSTANCE_LABEL=… INSTANCE_PARENT=… \
forge script script/DeploySepolia.s.sol --rpc-url sepolia --broadcast --verify
```
