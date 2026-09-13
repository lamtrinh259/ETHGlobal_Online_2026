# Selfie Check: what integrating it was actually like

Notes kept while wiring World ID's Selfie Check into ShibbolETH as the proof that one human holds one
account. Written for World, so it records what cost time rather than what worked. The integration is
live: `POST /v1/humanity/challenge` and `POST /v1/humanity` in `apps/api`, IDKit in `apps/web`.

Everything below was hit on a real integration, not read in the docs.

## 1. The signal is hashed as bytes, and nothing says so

The costliest one. A proof is bound to a signal — here the candidate's wallet address. The server
builds the same binding to verify it, and every proof was refused.

IDKit hashes a signal that *looks like hex* as **bytes**, not as text. `0xEE48…` is 42 ASCII
characters, and also 20 bytes; the client hashed the 20 bytes, the server hashed the 42 characters,
and the two never met. Nothing in the API response distinguishes this from a forged proof — it is the
same refusal.

What fixed it was reading `hashSignal` out of `idkit-core` and reimplementing it exactly:

```ts
const body = signal.startsWith("0x") ? signal.slice(2) : "";
const isHex = body.length > 0 && body.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(body);
return hashToField(isHex ? hexToBytes(`0x${body}`) : stringToBytes(signal));
```

**Ask:** document the rule where the signal is documented, and publish `hashSignal` as something a
backend in another language can copy. An address is the most obvious signal there is, and it is
exactly the case the rule changes.

## 2. `environment_mismatch` does not say which side to change

An app created in one environment and a widget configured for another returns `environment_mismatch`.
The message does not say which of the two the caller should move, and both are plausible. Our own
error now appends which setting to change, because the API's does not.

**Ask:** name the app's environment in the error. The caller knows the one they sent.

## 3. Sandbox needs two things that are not in the same place

Running against sandbox needs the separate sandbox World App — TestFlight only — *and* a Selfie Check
feature flag enabled on the app. Neither is discoverable from the failure, and the TestFlight build
was not visible to us when we looked. The result is that a developer who follows the sandbox docs
gets a working configuration that cannot be exercised.

**Ask:** state both prerequisites on the sandbox page, and fail with a message that names the missing
one.

## 4. "Success" in the app, failure in the widget

The most confusing failure to report to a user: World App showed the check succeeding while the
embedded widget showed it failing. From the outside these are one action, and the person has no way
to know which half to believe — or whether to try again. This was ours (see §1), but the shape of it
is World's: a proof that verifies in the app and is refused downstream looks like a broken product.

**Ask:** a distinct code for "the proof was valid, the verification call rejected it", separate from a
proof that did not verify.

## 5. Orb and Selfie Check are easy to conflate

`proofOfHuman()` and `selfieCheckLegacy()` differ in which credentials they accept, and it is possible
to configure a flow that asks for an Orb verification while intending Selfie Check. We wanted
Selfie Check only — the product's claim is "an accountable human", not "an Orb-verified human" — and
it took a pass through the SDK to be sure which we had.

**Ask:** make the credential the call asks for visible in the widget, so an integrator can see what
they configured without reading the SDK.

## 6. What worked well

- The nullifier is the right primitive: scoped per human, per app and per action, it makes "one human,
  one account" a uniqueness constraint rather than a policy. It is enforced off chain — the relay
  remembers nullifier → wallet and refuses a second wallet — because the nullifier is not ours to
  publish, and because its stability across proofs turned out to be an open question (§8).
- Revealing nothing about the person is what let us put the check in front of a reference at all.
  A voucher proves they are a person without telling the candidate, or us, who.
- IDKit's browser flow needed no styling work to look like it belonged.

## 7. The "Sybil score" from the presentation is not in the API

The hackathon presentation described Selfie Check returning a *"Sybil score, a similarity signal
that flags whether the user has created an abnormal number of accounts on your platform."* We went
to wire it into a profile, and could not find it.

`POST /api/v4/verify/{rp_id}` documents `success`, `action`, `nullifier`, `created_at`,
`environment`, `session_id`, `results[]` and `message` — no score, no similarity, nothing about
account counts. The Selfie Check credential page says it outright: *"It returns a proof of the
completed check, not a numeric Sybil or uniqueness score."* The sandbox testing page is silent.

So either the score is delivered somewhere the docs do not name — a webhook, the portal, a header —
or it was announced ahead of the API. Either way an integrator cannot build on it today. What we
built instead is a sybil signal from our own reference graph, seeded by who holds a live Selfie
Check proof; if the score turns up, it has a place to go (`.issues/open/T003-sybil-graph.md`, item 1).

The ask: say where the score is, or say that it is not yet exposed. A feature on a slide that is
absent from the reference is the most expensive kind to integrate, because the search for it has no
end condition.

## 8. Whether a nullifier is stable for a person is answered twice, differently (2026-09-12)

The whole rule — one human, one account — needs a nullifier that is still the same person tomorrow.
World's own documentation says both things:

- `world-id/idkit/integrate`: "The same person verifying the same action always produces the same
  nullifier."
- `world-id/4-0-migration`: "In 4.0, nullifiers are one-time-use, and `session_id` is the stable link."

If the second governs a v4 uniqueness proof, two fresh proofs from one person carry two nullifiers and
a dedupe on the nullifier never fires. We could not settle it from the docs, so the integration is
written to hold under either reading: a session proof is refused outright (it carries no per-action
nullifier), the widget asks for legacy proofs, which do carry the stable per-action one, and the copy
claims only that a verified human proved this at a point in time. The code says as much where it is
decided (`apps/api/src/app.ts`, above the `humans` map, and `humanityRecordId` in `src/world.ts`).

**Ask:** one sentence per protocol version stating whether a uniqueness proof's nullifier is stable for
a person across proofs, and if it is not, which value is. Nothing downstream can be designed without it.

## 9. Running the check again on one person takes two deletions, and one is ours (2026-09-13)

A demo runs the same human through the flow repeatedly, which means undoing a pass. It takes both
halves, and either alone leaves the person stuck: forget the nullifier → wallet binding off chain, or a
second attempt answers 409; delete the humanity record on chain, or the badge says they are already
human. `POST /v1/admin/humanity/reset` does both, and the `/admin` page is that one button.

The third thing cost the most, and it is Multipass rather than World: a record's nonce is kept per id
even after `deleteName`, so a re-proof has to sign a nonce above a number belonging to a record that no
longer exists. Two fixes, both shipped: the API's index remembers the nonce of deleted records
(`lastNonce`, `apps/api/src/indexer.ts`) and the browser retries once with the number the revert itself
names (`attempt`, `apps/web/app/AttestFlow.tsx`).

**Ask:** say in the docs whether a nullifier can be released for testing, or give sandbox an action that
resets one. Everybody building uniqueness has to re-test it on themselves, and there is no documented
way to do that twice.

## 10. A check in the critical path needs an off switch (2026-09-13)

`POST /v1/admin/selfie-check` with `{required: boolean}` turns the requirement off for everyone, or back
on, persisted in the data dir; the `GET` says what is in force and whether the browser is still offered
the check. It exists because the Selfie Check sits in front of the one action a demo is about, and three
of the failures above (§2, §3, §4) are invisible from inside the product. Being able to drop the
requirement for everyone without a redeploy is what keeps the rest demonstrable while the cause is
found.

**Ask:** nothing here is World's to fix. It is recorded because it is what an integrator ends up
building when a dependency in the critical path has no fallback of its own.

## 11. Where this lives in the code

| Piece | Where |
|---|---|
| Challenge, signed as this app | `POST /v1/humanity/challenge` (`apps/api/src/app.ts`) |
| Verification and the nullifier write | `POST /v1/humanity` |
| `hashSignal`, and the environment error | `apps/api/src/world.ts` |
| The widget | `apps/web/app/me/HumanityCheck.tsx` |
| Why the proof is checked in the relay and not the enclave | `docs/architecture.md` |
| Turning the check off for everyone, and reading what is in force | `GET` / `POST /v1/admin/selfie-check` |
| Undoing one person's pass: forget the nullifier, delete the record | `POST /v1/admin/humanity/reset`, `apps/web/app/admin` |
| Climbing past the nonce a deleted record left behind | `lastNonce` (`apps/api/src/indexer.ts`), `attempt` (`apps/web/app/AttestFlow.tsx`) |
