# Docs

ShibbolETH: permanent, human-verified vouches as ENS names under `shibboleth.eth`, on Ethereum
Sepolia. [The root README](../README.md) is the three-minute version; this is everything else.

## Start here

| Doc | One line |
|---|---|
| [architecture.md](architecture.md) | The components, the write path from a browser signature to a Multipass record, the Selfie Check, and who can do what. |
| [namespace.md](namespace.md) | What every name under `shibboleth.eth` means, and why a platform is mounted at its own DNS name. |
| [demo.md](demo.md) | The live deployment walked end to end with `curl` and `cast`, including the names that must *not* resolve. |

## The diagrams

| What it draws | Where |
|---|---|
| The name tree under `shibboleth.eth`, and how one resolver answers all of it | [namespace.md](namespace.md) |
| The write path: a wallet signature → the attester → the relay → the bridge → Multipass | [architecture.md](architecture.md#the-write-path) |
| The Selfie Check: a World proof → a nullifier bound off chain → a record on chain | [architecture.md](architecture.md#the-selfie-check-one-human-one-account) |
| Where a view code comes from, and who a grant opens it for | [disclosure.md](disclosure.md) |
| What the components are and how they talk | [architecture.md](architecture.md#components) and the [root README](../README.md) |

## Reference

| Doc | One line |
|---|---|
| [deploy.md](deploy.md) | Runbook: contracts on Sepolia, the CRE workflow, both Coolify apps, preview deployments, storage. |
| [disclosure.md](disclosure.md) | View codes and the permissions that open a masked account — to one reader, to a branch, or to whoever holds a link. |
| [employers.md](employers.md) | `/employers`: one policy, a shortlist kept in the reader's own browser, and an invitation for somebody who has no page yet. |
| [troubleshooting.md](troubleshooting.md) | Symptoms met on the live deployment, each with the first thing to read rather than a guess. |
| [root-wildcard-resolver.md](root-wildcard-resolver.md) | How the tree came to be served by one resolver: the plan, the migration, and the state of Sepolia after each step. Partly historical. |
| [selfie-check-feedback.md](selfie-check-feedback.md) | What integrating World ID's Selfie Check actually cost, written for World. |

## Per package

| README | One line |
|---|---|
| [apps/api](../apps/api/README.md) | Every route the relay answers, the index, the humanity exchange, and what the docker e2e covers. |
| [apps/web](../apps/web/README.md) | Every page of the portal, who it is for, and which pure modules it is built from. |
| [packages/contracts](../packages/contracts/README.md) | The contracts, the CRE report path, registration versus renewal, and the merged error ABI. |
| [packages/cre](../packages/cre/README.md) | The `attest` workflow: three handlers, its config, and how to run the enclave handler without deploy access. |
| [packages/registrar](../packages/registrar) | The pure attester both hosts call. No README; the types are the documentation. |

## Conventions

- [CONTRIBUTING.md](../CONTRIBUTING.md) — tests first, what `pnpm verify` covers, and how to read a
  Forgejo run.
- The subject of an instance is a deployment argument. No domain name, parent name or product name is
  hard-coded in `src/`.
- Resolver text keys read `ketsuban:*` and names claimed before the rename stay on `ketsuban.eth`.
  Both are live on chain, so both stay written as they are.
