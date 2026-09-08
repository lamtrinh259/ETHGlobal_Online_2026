/**
 * Writes a simulation fixture: a request signed by a throwaway wallet with an identity token
 * from a fake Privy issuer whose JWK is written into config.local.json. Simulation-only.
 *
 *   bun run scripts/make-fixture.ts [name|optin]
 */
import { baseIntent, fakePrivy, fakeUser, signedAttestRequest, toWire } from "@att/registrar/testing";
import { toBytes32, type Hex } from "@peeramid-labs/multipass-client";
import { writeFileSync, readFileSync } from "node:fs";

const USER_KEY = "0x000000000000000000000000000000000000000000000000000000000000a11c" as const;
const cfg = JSON.parse(readFileSync(new URL("../config.staging.json", import.meta.url), "utf8"));
const privy = fakePrivy("local-app-id", "local-privy-key");
const user = fakeUser(USER_KEY, "fatpig");
const now = Math.floor(Date.now() / 1000);

const [domain, handle, payload] = process.argv[2] === "name"
  ? [cfg.nameDomains[0], "fatpig", toBytes32("terrible dictator")]
  : ["x", "", undefined];
const optIn = process.argv[2] === "optin";
const intent = baseIntent(user.account, now, {
  domain,
  handle,
  optIn,
  ...(payload ? { payload } : {}),
  exp: BigInt(now + 7 * 86400),
});
const idToken = privy.mint({ sub: user.did, linked: user.linked, now, ttlSeconds: 7 * 86400 });
const req = await signedAttestRequest(user.account, intent, idToken, cfg.chainId, cfg.multipass as Hex);

writeFileSync(new URL("../fixtures/request.json", import.meta.url), JSON.stringify(toWire(req), null, 2) + "\n");
writeFileSync(
  new URL("../config.local.json", import.meta.url),
  JSON.stringify({ ...cfg, privy: { appId: privy.appId, verificationKey: privy.jwk } }, null, 2) + "\n"
);
console.log(`fixture for ${user.account.address} domain=${domain} optIn=${optIn} → fixtures/request.json, config.local.json`);
