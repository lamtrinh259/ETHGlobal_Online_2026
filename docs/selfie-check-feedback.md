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

**6. The "Sybil score" from the presentation is not in the API.** `POST /api/v4/verify/{rp_id}` returns
`success`, `action`, `nullifier`, `created_at`, `environment`, `session_id`, `results[]`; the credential
page says it returns "not a numeric Sybil or uniqueness score". *Ask:* say where it is, or that it is
not yet exposed. What we built instead is §10.

**7. Nullifier stability is documented twice, differently (2026-09-12).** `idkit/integrate`: the same
person and action always produce the same nullifier. `4-0-migration`: nullifiers are one-time, and
`session_id` is the stable link. A uniqueness rule cannot be designed on both. We refuse session
proofs, ask for legacy proofs (stable per-action nullifier), and claim only "a verified human proved
this at a point in time". *Ask:* one sentence per protocol version: is a uniqueness proof's nullifier
stable for a person, and if not, what is.

**8. Re-running the check on one person takes two deletions (2026-09-13).** Forget the binding or the
second attempt answers 409; delete the chain record or the badge says already human.
`POST /v1/admin/humanity/reset` does both. A third cost was Multipass, not World: a deleted record
keeps its nonce, so the index remembers it (`lastNonce`) and the browser retries with the number the
revert names. *Ask:* a documented way to release a nullifier for testing, or a sandbox reset action.
Everybody building uniqueness re-tests on themselves.

**9. A check in the critical path needs an off switch (2026-09-13).** `POST /v1/admin/selfie-check`
`{required}` drops the requirement for everyone without a redeploy, because §2–§4 are invisible from
inside the product. Nothing for World to fix; recorded as what an integrator ends up building.

**10. What the proof became: a SybilScore (2026-09-13).** Every person who passed the Selfie Check
is a trusted seed. Trust flows from the seeds along vouches, and a writer's trust is split among the
people they vouch for, so vouching for a hundred accounts gives each a hundredth. A group of accounts
with no verified human among them scores zero. The method is SybilRank's; the code is
`apps/api/src/graph.ts`. A World-side "Sybil score", if it ships, would set how much each seed is
worth.

**11. A deleted user leaves a proof World still remembers (2026-09-13).** Privy refuses to unlink a
user's only login, so a demo reset deletes the Privy user, and with it the embedded wallet. Our side
forgets the nullifier and deletes the chain records (`POST /v1/admin/privy/delete`). The person's
World proof for this action is not ours to forget: a new wallet presenting the same nullifier is what
§7 is about, and a stale binding would refuse it. Same ask as §8.

## 2. User feedback

What the people we onboarded said, as distinct from what we hit building it.

**12. The App Store listing says the opposite of the product (2026-09-13).** World App's download screen
lists data collected: identifiers, usage data, diagnostics, location. A person is sent there to prove
they are human *without revealing who*, and the first thing they read is a privacy label that says
more is collected than most apps admit to. Whatever the reasons, it is the wrong first impression for a
privacy product, and it is what the people we onboarded remarked on. *Ask:* "Data Not Collected" is
the label to aim for; where a category cannot be dropped, say on the listing why the proof does not
carry it.

**13. One action, two answers (2026-09-13).** The person taps through World App, sees it succeed, and
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
