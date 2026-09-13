# Selfie Check: what integrating it cost

Notes for World from wiring the Selfie Check into ShibbolETH as "one human, one account". Live:
`POST /v1/humanity/challenge` and `POST /v1/humanity` in `apps/api`, IDKit in `apps/web`. Everything
here was hit on the real integration.

## 1. Developer feedback

### What worked

- The nullifier is the right primitive: per human, per app, per action, so uniqueness is a constraint
  rather than a policy. We keep nullifier → wallet off chain and refuse a second wallet.
- The proof says nothing about the person, which is what lets a voucher prove they are human without
  telling the candidate, or us, who.
- IDKit's browser flow, the cloud verify endpoint, and sandbox once both halves (§3) were found.

### What cost time

**1. The signal is hashed as bytes, and nothing says so.** A signal that looks like hex (`0xEE48…`, a
wallet) is hashed as 20 bytes by IDKit and as 42 characters by a server that follows the docs; every
proof was refused, indistinguishable from a forgery. Fixed by copying `hashSignal` out of `idkit-core`.
*Ask:* document the rule beside the signal, and publish `hashSignal` for other languages.

**2. `environment_mismatch` does not say which side to change.** App and widget environments differ;
the error names neither. *Ask:* name the app's environment in the error.

**3. Sandbox needs two things in two places:** the TestFlight-only sandbox World App and a Selfie
Check feature flag on the app. Neither failure names the missing one. *Ask:* both on the sandbox page,
and an error that says which is missing.

**4. "Success" in World App, failure in the widget.** One action, two answers, and the person cannot
tell which to believe. *Ask:* a distinct code for "valid proof, verification refused it".

**5. Orb and Selfie Check are easy to conflate.** `proofOfHuman()` vs `selfieCheckLegacy()` differ in
accepted credentials; which one a flow asks for is only visible in the SDK. *Ask:* show the credential
asked for in the widget.

**6. The "Sybil score" from the presentation is not in the API, and the one we need is per cluster.**
`POST /api/v4/verify/{rp_id}` returns `success`, `action`, `nullifier`, `created_at`, `environment`,
`session_id`, `results[]`; the credential page says it returns "not a numeric Sybil or uniqueness
score". Meanwhile we compute our own over the vouch graph, seeded by who passed the check
(`apps/api/src/graph.ts`). What would help most is a score scoped to a subset of our users: the
people who vouch for one candidate, an employer's shortlist, one company's cohort. That says whether a
cluster is many humans or one operator, which a per-user signal cannot. The way to get it today would
be one World app id per cluster, which is a hack. *Ask:* say where the score is or that it is not yet
exposed, and consider a query over a set of nullifiers (or an action per cluster) that returns how many
distinct humans are behind them.

**7. Nullifier stability is documented twice, differently (2026-09-12).** `idkit/integrate`: the same
person and action always produce the same nullifier. `4-0-migration`: nullifiers are one-time, and
`session_id` is the stable link. A uniqueness rule cannot be designed on both. We refuse session
proofs, ask for legacy proofs (stable per-action nullifier), and claim only "a verified human proved
this at a point in time". *Ask:* one sentence per protocol version: is a uniqueness proof's nullifier
stable for a person, and if not, what is.

**8. There is no way to reset a person for testing (2026-09-13).** Everybody building uniqueness
re-tests on themselves. We can forget our nullifier → wallet binding and delete our chain record, and
we do (`POST /v1/admin/humanity/reset`, `/v1/admin/privy/delete`), but World still remembers the
proof, and a user we had to delete outright (Privy will not unlink a sole login) leaves a proof nobody
on our side can release. *Ask:* a documented way to release a nullifier in sandbox, or a reset action.

**9. We had to build a kill switch (2026-09-13).** The Selfie Check stands in front of the one thing
the product does: writing a vouch. When it broke (§2, §3, §4), nobody could vouch for anybody, and
from inside our app there was no way to tell whether World or we were at fault. So we added an admin
switch that turns the check off for everyone until the cause is found. *Ask:* a status page or a
health endpoint for the verify API and the app, so an integrator can tell "World is down" from "we
broke it".

## 2. User feedback

What the people we onboarded said, as distinct from what we hit building it.

**10. The App Store listing says the opposite of the product (2026-09-13).** World App's download screen
lists data collected: identifiers, usage data, diagnostics, location. A person is sent there to prove
they are human *without revealing who*, and the first thing they read is a privacy label that says
more is collected than most apps admit to. Whatever the reasons, it is the wrong first impression for a
privacy product, and it is what the people we onboarded remarked on. *Ask:* "Data Not Collected" is
the label to aim for; where a category cannot be dropped, say on the listing why the proof does not
carry it.

**11. One action, two answers (2026-09-13).** The person taps through World App, sees it succeed, and
comes back to a widget that says it failed (§4). From their side both are "the Selfie Check", and the
only recovery they can think of is to do it again, which does not help. *Ask:* when the app and the
widget disagree, one of them should say which one to believe and what to do next.

## Where it lives

| Piece | Where |
|---|---|
| Challenge signed as this app; verification and the nullifier write | `POST /v1/humanity/challenge`, `POST /v1/humanity` (`apps/api/src/app.ts`) |
| `hashSignal`, the environment error | `apps/api/src/world.ts` |
| The widget | `apps/web/app/me/HumanityCheck.tsx` |
| SybilScore and rank over the vouch graph | `apps/api/src/graph.ts`, `GET /v1/graph/:handle` |
| Off switch; per-person and platform-wide resets; delete user | `/v1/admin/selfie-check`, `/v1/admin/humanity/reset`, `/v1/admin/humanity/reset-all`, `/v1/admin/privy/delete`, `/admin` |
| Nonce left by a deleted record | `lastNonce` (`apps/api/src/indexer.ts`), `attempt` (`apps/web/app/AttestFlow.tsx`) |
| Why the proof is checked in the relay, not the enclave | `docs/architecture.md` |
