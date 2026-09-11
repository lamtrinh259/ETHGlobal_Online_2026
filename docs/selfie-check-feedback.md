# Selfie Check: what integrating it was actually like

Notes kept while wiring World ID's Selfie Check into Ketsuban as the proof that one human holds one
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

- The nullifier is exactly the right primitive: stable per human per app per action, and it makes
  "one human, one account" a uniqueness constraint rather than a policy. Multipass refuses a second
  record carrying the same nullifier, so the rule is enforced on chain, not by us.
- Revealing nothing about the person is what let us put the check in front of a reference at all.
  A voucher proves they are a person without telling the candidate, or us, who.
- IDKit's browser flow needed no styling work to look like it belonged.

## 7. Where this lives in the code

| Piece | Where |
|---|---|
| Challenge, signed as this app | `POST /v1/humanity/challenge` (`apps/api/src/app.ts`) |
| Verification and the nullifier write | `POST /v1/humanity` |
| `hashSignal`, and the environment error | `apps/api/src/world.ts` |
| The widget | `apps/web/app/me/HumanityCheck.tsx` |
| Why the proof is checked in the relay and not the enclave | `docs/architecture.md` |
