/**
 * Docker e2e: anvil + deployed contracts + the API image, driven from the host.
 *
 *   pnpm --filter @ketsuban/api test:e2e
 *
 * Requires docker compose; `global-setup.ts` boots the compose file, which deploys
 * `DeployLocal.s.sol` into anvil and starts the API image against it. The full loop is exercised: intent → attest (node registrar) → delivery →
 * bridge.verify on chain → name resolves through the ENS shim → verify endpoint.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { bytesToHex, createPublicClient, http, zeroHash, type Hex } from "viem";
import { baseIntent, fakePrivy, fakeUser, signedAttestRequest, toWire } from "@ketsuban/registrar/testing";
import { eciesDecrypt } from "@ketsuban/registrar";
import { decodeRecord, MultipassAbi, toBytes32 } from "@peeramid-labs/multipass-client";
import { APP_ID, PRIVY_SEED } from "./global-setup.js";

const API = process.env.E2E_API_URL ?? `http://127.0.0.1:${process.env.E2E_API_PORT ?? "18787"}`;
const RPC = process.env.E2E_RPC_URL ?? `http://127.0.0.1:${process.env.E2E_ANVIL_PORT ?? "18545"}`;
const privy = fakePrivy(APP_ID, PRIVY_SEED);
const USER_KEY = "0x000000000000000000000000000000000000000000000000000000000000a11c" as const;
const user = fakeUser(USER_KEY, "alice");

let deployment: { multipass: Hex; instanceDomain: string; instanceParent: string };

async function waitFor(url: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timeout waiting for ${url}`);
}

beforeAll(async () => {
  await waitFor(`${API}/healthz`);
  deployment = JSON.parse(
    readFileSync(new URL("../../../../packages/contracts/deployments/local.json", import.meta.url), "utf8")
  );
});

describe("api e2e", () => {
  it("lists the deployed instance", async () => {
    const { instances } = await (await fetch(`${API}/v1/instances`)).json();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      domain: deployment.instanceDomain,
      parentName: deployment.instanceParent,
    });
  });

  it("attests, delivers, and resolves a name record end to end", async () => {
    const now = Math.floor(Date.now() / 1000);
    const answer = toBytes32("terrible dictator");
    const intent = baseIntent(user.account, now, {
      domain: deployment.instanceDomain,
      handle: "alice",
      payload: answer,
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));

    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.record).toMatchObject({
      name: toBytes32("alice"),
      domainName: toBytes32(deployment.instanceDomain),
      payload: answer,
      nonce: "1",
      wallet: user.account.address,
    });

    const delivered = await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();
    expect(delivered.ok).toBe(true);
    expect(delivered.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const pc = createPublicClient({ transport: http(RPC) });
    const [ok, onchain] = await pc.readContract({
      address: deployment.multipass,
      abi: MultipassAbi,
      functionName: "resolveRecord",
      args: [
        {
          name: toBytes32("alice"),
          id: zeroHash,
          wallet: "0x0000000000000000000000000000000000000000",
          domainName: toBytes32(deployment.instanceDomain),
          targetDomain: zeroHash,
        },
      ],
    });
    expect(ok).toBe(true);
    expect(onchain.wallet).toBe(user.account.address);
    expect(onchain.payload).toBe(answer);

    const name = `alice.${deployment.instanceParent}`;
    const verified = await (await fetch(`${API}/v1/verify/${name}`)).json();
    expect(verified).toMatchObject({
      name,
      status: "active",
      wallet: user.account.address,
      answer: "terrible dictator",
      humanity: null,
      links: [],
      decision: "additional_context_available",
    });
    expect(new Date(verified.expiresAt).getTime() / 1000).toBe(Number(attested.record.validUntil));
  });

  it("links an opted-in platform account and discloses it only with the view code", async () => {
    const now = Math.floor(Date.now() / 1000);
    const intent = baseIntent(user.account, now, { domain: "x", optIn: true, exp: BigInt(now + 3600) });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const attested = await (
      await fetch(`${API}/v1/attest`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(req),
      })
    ).json();
    expect(attested.viewCode).not.toBeNull();
    const viewCode = bytesToHex(eciesDecrypt(USER_KEY, attested.viewCode));
    expect(decodeRecord(attested.record, viewCode)).toEqual({
      handle: "alice",
      platformId: "1234567890123456789",
    });

    const delivered = await (
      await fetch(`${API}/v1/cre/delivery`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-delivery-token": "e2e-delivery-token-0123456789" },
        body: JSON.stringify(attested),
      })
    ).json();
    expect(delivered.ok).toBe(true);

    const name = `alice.${deployment.instanceParent}`;
    const masked = await (await fetch(`${API}/v1/verify/${name}?links=x`)).json();
    expect(masked.links).toEqual([{ domain: "x", optedIn: true, commitment: attested.record.payload }]);

    const disclosed = await (await fetch(`${API}/v1/verify/${name}?links=x&viewCode=${viewCode}`)).json();
    expect(disclosed.links[0].disclosed).toEqual({ handle: "alice", platformId: "1234567890123456789" });
    expect(disclosed.evidence).toContain("x_account_control");
  });

  it("rejects a replayed record", async () => {
    const now = Math.floor(Date.now() / 1000);
    const intent = baseIntent(user.account, now, {
      domain: "x",
      optIn: true,
      nonce: 1n,
      exp: BigInt(now + 3600),
    });
    const idToken = privy.mint({ sub: user.did, linked: user.linked, now });
    const req = toWire(await signedAttestRequest(user.account, intent, idToken, 31337, deployment.multipass));
    const res = await fetch(`${API}/v1/attest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "intent: nonce not increasing" });
  });
});
