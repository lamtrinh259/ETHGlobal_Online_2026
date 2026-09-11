/**
 * Writes a simulation fixture: a request signed by a throwaway wallet with an identity token
 * from a fake Privy issuer whose JWK is written into config.local.json. Simulation-only.
 *
 *   bun run scripts/make-fixture.ts [name|optin|dns|dns-private|vouch <candidate> <voucher> "<statement>"]
 *
 * Each mode writes `fixtures/<mode>.json`, and the default one is also written as `fixtures/request.json`
 * so `pnpm simulate` keeps working with no arguments.
 *
 * NONCE=<n> overrides the intent nonce: a record that already exists on the target chain needs the
 * next one, and the enclave checks that before it signs.
 */
import { baseIntent, fakePrivy, fakeUser, signedAttestRequest, toWire } from "@ketsuban/registrar/testing";
import { toBytes32, type Hex } from "@peeramid-labs/multipass-client";
import { generatePrivateKey } from "viem/accounts";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

/**
 * A wallet with no history on the target chain.
 *
 * The enclave refuses an intent whose nonce does not exceed the one on chain, so a fixture signed by a
 * fixed key stops working the moment that key holds a record in the domain it targets — which is what
 * happened to the default one here: `x` reached nonce 1 and every later run asked for nonce 1 again. A
 * fresh key holds nothing anywhere, so nonce 1 is always the next one. `FIXTURE_KEY=0x…` pins it when
 * a reproducible request is wanted.
 */
const key = () => (process.env.FIXTURE_KEY as Hex) ?? generatePrivateKey();
const cfg = JSON.parse(readFileSync(new URL("../config.staging.json", import.meta.url), "utf8"));
const privy = fakePrivy("local-app-id", "local-privy-key");
const mode = process.argv[2] ?? "platform";
const user = mode === "vouch" ? fakeUser(key(), process.argv[4] ?? "bob") : fakeUser(key(), "alice");
const now = Math.floor(Date.now() / 1000);

const [domain, handle, payload] =
  mode === "name"
    ? [cfg.nameDomains[0], "alice", toBytes32("terrible dictator")]
    : mode === "vouch"
      ? [`~${process.argv[3]}`, process.argv[4] ?? "bob", toBytes32(process.argv[5] ?? "worked together 2019-22")]
      : // A platform is a DNS name in this namespace, and the enclave signs into it the same way.
        mode === "dns" || mode === "dns-private"
        ? ["x.com", "", undefined]
        : ["x", "", undefined];
const optIn = mode === "optin" || mode === "dns-private";
const intent = baseIntent(user.account, now, {
  domain,
  handle,
  optIn,
  ...(process.env.NONCE ? { nonce: BigInt(process.env.NONCE) } : {}),
  ...(payload ? { payload } : {}),
  exp: BigInt(now + 7 * 86400),
});
const idToken = privy.mint({ sub: user.did, linked: user.linked, now, ttlSeconds: 7 * 86400 });
const req = await signedAttestRequest(user.account, intent, idToken, cfg.chainId, cfg.multipass as Hex);

// Gitignored, so a clean clone has no directory to write into and the failure is a bare ENOENT.
mkdirSync(new URL("../fixtures/", import.meta.url), { recursive: true });
const wire = JSON.stringify(toWire(req), null, 2) + "\n";
writeFileSync(new URL(`../fixtures/${mode}.json`, import.meta.url), wire);
if (mode === "platform") writeFileSync(new URL("../fixtures/request.json", import.meta.url), wire);
writeFileSync(
  new URL("../config.local.json", import.meta.url),
  JSON.stringify({ ...cfg, privy: { appId: privy.appId, verificationKey: privy.jwk } }, null, 2) + "\n"
);
console.log(`fixture for ${user.account.address} domain=${domain} optIn=${optIn} → fixtures/${mode}.json, config.local.json`);
