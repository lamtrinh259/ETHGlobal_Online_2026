# One wildcard resolver at the root — plan, spike, migration

Branch: `spike/root-wildcard-resolver`. Spike: `packages/contracts/src/RootAttestationResolver.sol`,
tests in `test/RootAttestationResolver.t.sol` (10 passing, forge, local).

## Where we are

Every mount is its own pair of contracts, deployed once per platform, subject and candidate:

| level | registry | resolver |
|---|---|---|
| `ketsuban.eth` | `AttestationRegistry` (root instance) | `AttestationResolver` |
| `www`, `@`, `private-www`, `private@` | `GroupingRegistry` | none (a path, not a name) |
| `com.x.www…`, `com.github.www…` | `AttestationRegistry` per platform | `AttestationResolver` per platform |
| `com.x.private-www…` | `MaskedMirrorRegistry` per platform | `AttestationResolver` |
| `kju-is.ketsuban.eth` | `AttestationRegistry` | `AttestationResolver` |
| `alice.ketsuban.eth` (vouch mount `~alice`) | `AttestationRegistry` per candidate | `AttestationResolver` |

Every resolver is already an ENSv2 wildcard (`IExtendedResolver.resolve`) reading Multipass; ENS stores
nothing. The registries exist for one reason: the Universal Resolver hands a name to the nearest ancestor
resolver, and a root resolver that did not know the tree answered `alice.<anything>.<root>` as alice. So each
level got a registry, and each resolver answers only for names one label below its own parent.

Cost: two deployments per platform, one per candidate (on first reference), one per subject; a factory,
a bridge that provisions vouch mounts, and an API that enumerates the factory to know the tree.

## Where this goes

One `RootAttestationResolver` at `ketsuban.eth`. It knows the tree because Multipass is the tree: a name
minus the root is `<label>.<path>`, and the path names a Multipass domain —

| path | domain | example |
|---|---|---|
| (none) | root name domain | `alice.ketsuban.eth` |
| `<subject>` | that name domain, if Multipass holds it | `alice.kju-is.ketsuban.eth` |
| `<candidate>` | `~candidate`, if Multipass holds it | `bob.alice.ketsuban.eth` |
| `<dns reversed>.www` / `.@` | the platform / mail host | `alice_x.com.x.www.ketsuban.eth` → `x.com` |
| `<dns reversed>.private-www` / `.private@` | the same, masked | `alice.com.x.private-www.ketsuban.eth` |

A path Multipass has no domain for answers nothing (`locate().known == false`), which is the guarantee the
registries gave. The masked branch keeps the mirror's rule: the label is the person's root name, and the
answer says only that their wallet holds a live masked record in that platform domain.

Same keys as today: `addr`, `ketsuban:answer`, `ketsuban:expiry`, `ketsuban:humanity[:until]`,
`ketsuban:link:<domain>`, `addr.reverse`; everything else forwarded to the stock PermissionedResolver.

## What the spike proves (forge, local)

- root, subject, candidate and platform paths resolve from the right domain, by label;
- an unknown level, an unknown platform, an unknown grouping, a name outside the root: nothing;
- masked branch answers the person's wallet only while a masked record is live, never the account;
- humanity hops by wallet from any name; expiry ends every answer; reverse gives the root name;
- gas: one to three Multipass reads per resolve, no storage of its own.

## What is not in the spike yet

1. **`setAbout` / `about`** — the operator's text for an unclaimed label (a public figure's description).
   Today per instance; here it is one owner-gated mapping keyed by `(domain, label)`. Half a day.
2. **Subject and candidate labels collide by design**: `alice` could be both a subject domain and a
   candidate's vouch domain `~alice`. The spike prefers the name domain. Multipass domain names are chosen by
   the operator, so the rule is a policy: subjects must not be named like handles. Write it down; add a
   check to `InitDomains`.
3. **Aliases** (`INNER.getAlias`) are honoured as today; untested here.
4. **Domain names longer than 31 bytes** cannot be Multipass domains at all; a long DNS host under `www`
   answers nothing, as it does today.

## What the spike lacked, now in

- `setAbout(domain, label, key, value)` on the root resolver; answer namespaces (`<slug>.<question>`);
  `parentNameOf(domain)`, the inverse rule, which the bridge asks where the factory has no instance
  (`AttestationBridge.setRootResolver`), so a new name still gets its four text-record grants.
- Two caveats the tree now carries: any name domain without a dot resolves as a subject
  (`<label>.<domain>.<root>`), so the flat platform domains an early deployment initialised (`x`,
  `github`, …) resolve their public records that way — nothing private, and nothing the old tree did not
  hold; and `parentNameOf` decides `www` versus the at-sign level from a constant list of platform hosts
  that mirrors `PLATFORM_DNS_NAMES` off chain (every other host is mail). Adding a platform means adding
  it in both.

## Migration on Sepolia — no downtime, reversible

ENSv2 resolves by walking registries: a level that has a subregistry uses that registry's resolver, a level
that has none falls back to the nearest ancestor's. So the old and new trees can coexist, and the switch is
per level.

1. **Deploy** `RootAttestationResolver(mp, permissionedResolver, "ketsuban", "ketsuban.eth")`.
   Optionally `setAbout` the subject texts it must carry (step 1 above).
2. **Point the root at it**: `ETHRegistry.setResolver("ketsuban", root)` — `script/SetRootResolver.s.sol`
   already does exactly this for the current root resolver. From here every name with no registry of its
   own resolves through the new resolver: new platforms and new candidates need no deployment.
3. **Unmount, level by level, and verify each**: `rootRegistry.setSubregistry(label, address(0))` for
   `www`, `@`, `private-www`, `private@`, `kju-is`, then each candidate mount. After each, run
   `pnpm --filter @ketsuban/web check:live` (it resolves every name the attester claims through the
   Universal Resolver and compares wallets). The old registries stay deployed and inert; nothing in Multipass
   changes; no record is rewritten.
4. **Rollback** at any step: `setSubregistry(label, oldRegistry)` puts a level back on its old resolver;
   `setResolver("ketsuban", oldRoot)` puts the root back. Both are one transaction by the registry owner.

Ownership: `setResolver` / `setSubregistry` on the root are the operator's (the factory/bridge owner), the same
key that mounts today. Multipass ownership is untouched.

## Upgrade path for the code around it

- **Factory / bridge**: `AttestationFactory.create` and `createMirror` stop deploying. A mount becomes a
  record: `(domain → parentName, maskedParentName)`. The API's `/v1/instances` reads those records as it reads
  the factory now; nothing on the web changes shape. The bridge's "provision a vouch mount on first
  reference" becomes "initialise the Multipass domain `~handle`" only — it already does that half.
- **Alternative with no factory at all**: derive mounts from Multipass domains plus the name rule that
  `packages/registrar/src/namespace.ts` already encodes (`groupingFor`, `mountPath`, `ensNameFor`). The API
  would list `Multipass.domains()` and compute `parentName` per domain. Cleaner, larger: every place that reads
  `instance.registry` / `instance.resolver` (the wallet's own text records go through the resolver the
  registry names) has to read the root resolver instead.
- **Users' own text records** (`avatar`, `description`, `url`, `email`) live on the PermissionedResolver
  keyed by name node and are granted by the bridge on registration: unchanged.
- **Chainlink CRE handler**: unaffected; it signs Multipass records, never touches ENS.

## Local test plan before touching Sepolia

1. `forge test` — the spike suite and everything else (green, see below).
2. `script/DeployLocal.s.sol` variant: deploy the root resolver, set it on the mock ETH registry, create **no**
   per-platform instances; run the API docker e2e (`pnpm --filter @ketsuban/api test:e2e`) — it resolves
   names through the mock Universal Resolver path and exercises every read the app makes.
3. `check:live` against the local stack (`CHECK_API`/`CHECK_WEB`), then against Sepolia after each unmount.

## Recommendation

Do it in that order, on this branch: `setAbout` → factory becomes a mount registry → `DeployLocal` on the root
resolver → docker e2e green → Sepolia steps 1–3 with `check:live` between each. Two to three days. The
spike is the risky half and it is done.


## Runbook (Sepolia) — `packages/contracts/script/MigrateRoot.s.sol`

Every step is one owner transaction; every step has its rollback; `check:live` between steps resolves
every name the attester claims through the Universal Resolver and compares wallets.

```bash
cd packages/contracts
export RPC=$ETH_SEPOLIA_RPC_URL PRIVATE_KEY=$OPERATOR_KEY            # the registry owner / operator
export ETH_REGISTRY=0xBDC85dD5b15D7ecb354cd7cb6f2c50b4f2c4F0E2 REGISTRY=0x254D9c7601BD8fa6b6FA7f5A42c860d184E053A7
export MULTIPASS=0x418F82fd0014a4CA402F145978bfaF0555a9cA06 PERMISSIONED_RESOLVER=0x4E2d9783cEFF2ed72CD77C14206b29fe246b24F7
export ROOT_LABEL=ketsuban ROOT_DOMAIN=ketsuban ROOT_PARENT=ketsuban.eth

# 1. deploy — prints `rootResolver 0x…`; add it to deployments/11155111.json as "wildcardResolver"
#    (`rootResolver` there is the old root instance resolver, kept for the rollback)
#    (the API reads ROOT_RESOLVER from the deployment file, or from env) and redeploy the API
STEP=deploy forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
export ROOT_RESOLVER=0x…

# 2. bridge — the bridge grants a new name its text records by asking the root resolver
STEP=bridge BRIDGE=0xC7283bD9Aad1B08947C841536946Ce4dA9c99929 forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast

# 3. point — the root label resolves through it; every level with no registry of its own follows
STEP=point forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
pnpm --filter @ketsuban/web check:live

# 4. unmount, level by level — groupings first, then the subject, then each candidate mount;
#    the script prints the registry that was mounted, which the rollback needs
STEP=unmount LABELS=www,private-www forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
pnpm --filter @ketsuban/web check:live
STEP=unmount LABELS=@,private@ forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
STEP=unmount LABELS=kju-is forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
STEP=unmount LABELS=peersky,alice,… forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
pnpm --filter @ketsuban/web check:live

# rollbacks
STEP=remount LABEL=www REGISTRY_TO_MOUNT=0x… forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
STEP=unpoint RESOLVER=0x178ff1589Be8Af3B19426Aa1d2Bd07cd178E215e forge script script/MigrateRoot.s.sol --rpc-url $RPC --broadcast
```

After step 1 the API runs in root mode (`ROOT_RESOLVER` set): it reads the tree from Multipass domains
and the name rule, and provisioning a domain is `initializeDomain` alone. Steps 2–3 change what the
Universal Resolver walks; the API's own reads go straight to the root resolver either way.

Operator texts for unclaimed labels (`setAbout`) are per instance today; copy the ones that matter onto
the root resolver (`setAbout(domain, label, key, value)`) before step 3 unmounts the level that held them.

Local proof of the same path: `ROOT_MODE=1` on `DeployLocal.s.sol` deploys the root resolver and points the
mock ETH registry at it; `E2E_ROOT_MODE=1 pnpm --filter @ketsuban/api test:e2e` runs the API suite that way.
