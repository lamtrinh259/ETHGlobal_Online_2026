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

  it("provisions the candidate's vouch instance and lets a verified voucher write under it", async () => {
    const now = Math.floor(Date.now() / 1000);
    // Bob: a second human with his own wallet and linked accounts.
    const BOB_KEY = "0x000000000000000000000000000000000000000000000000000000000000b0bb" as const;
    const bob = fakeUser(BOB_KEY, "bob");
    const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${API}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
    const tok = { "x-delivery-token": "e2e-delivery-token-0123456789" };

    // Alice's root claim (earlier test) provisioned ~alice; a second delivery is idempotent.
    const vouches0 = await (await fetch(`${API}/v1/vouches/alice`)).json();
    expect(vouches0).toMatchObject({ handle: "alice", domain: "~alice", vouches: [] });

    // Bob claims his own name first (his vouching identity), then vouches for Alice.
    const claim = toWire(
      await signedAttestRequest(
        bob.account,
        baseIntent(bob.account, now, {
          domain: deployment.instanceDomain,
          handle: "bob",
          payload: toBytes32("hello"),
          exp: BigInt(now + 3600),
        }),
        privy.mint({ sub: bob.did, linked: bob.linked, now }),
        31337,
        deployment.multipass
      )
    );
    const bobClaim = await (await post("/v1/attest", claim)).json();
    const bobDelivered = await (await post("/v1/cre/delivery", bobClaim, tok)).json();
    expect(bobDelivered.ok).toBe(true);
    expect(bobDelivered.vouchInstance).toEqual({ domain: "~bob", created: true });

    const statement = toBytes32("worked together 2019-22");
    const vouch = toWire(
      await signedAttestRequest(
        bob.account,
        baseIntent(bob.account, now, {
          domain: "~alice",
          handle: "bob",
          payload: statement,
          exp: BigInt(now + 3600),
        }),
        privy.mint({ sub: bob.did, linked: bob.linked, now }),
        31337,
        deployment.multipass
      )
    );
    const attested = await (await post("/v1/attest", vouch)).json();
    expect(attested.record).toMatchObject({
      domainName: toBytes32("~alice"),
      name: toBytes32("bob"),
      payload: statement,
    });
    const delivered = await (await post("/v1/cre/delivery", attested, tok)).json();
    expect(delivered.ok).toBe(true);

    // The index must answer for a record this service wrote a moment ago, with no poll in between.
    const health = await (await fetch(`${API}/healthz`)).json();
    expect(health.index).toMatchObject({ synced: true });
    const aw = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    const bw = await (await fetch(`${API}/v1/wallet/${bob.account.address}`)).json();
    console.log(
      "DEBUG idx",
      JSON.stringify(health.index),
      "alice",
      JSON.stringify({ n: aw.names, l: aw.links, g: aw.given }),
      "bob",
      JSON.stringify({ n: bw.names, l: bw.links, g: bw.given })
    );
    const vouches = await (await fetch(`${API}/v1/vouches/alice`)).json();
    expect(vouches.vouches).toHaveLength(1);
    expect(vouches.vouches[0]).toMatchObject({
      voucher: "bob",
      voucherName: `bob.${deployment.instanceParent}`,
      wallet: bob.account.address,
      statement: "worked together 2019-22",
      nonce: "1",
      live: true,
    });

    // The vouch is an ENS name: bob.alice.<root> resolves through the nested instance.
    const name = `bob.alice.${deployment.instanceParent}`;
    const verified = await (await fetch(`${API}/v1/verify/${name}`)).json();
    expect(verified).toMatchObject({
      name,
      status: "active",
      wallet: bob.account.address,
      answer: "worked together 2019-22",
      instance: { domain: "~alice" },
    });
  });

  it("tops up a wallet that holds a live name exactly once, from the relayer", async () => {
    const rpc = createPublicClient({ transport: http(RPC) });
    const before = await rpc.getBalance({ address: user.account.address });
    const dash = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    expect(dash.balance).toBe(before.toString());
    expect(dash.gasTopup).toEqual({ enabled: true, amount: "2000000000000000", available: true });

    const res = await fetch(`${API}/v1/gas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: user.account.address }),
    });
    expect(res.status).toBe(200);
    const { hash, amount } = await res.json();
    expect(amount).toBe("2000000000000000");
    expect((await rpc.getTransactionReceipt({ hash })).status).toBe("success");
    expect(await rpc.getBalance({ address: user.account.address })).toBe(before + 2_000_000_000_000_000n);

    const again = await fetch(`${API}/v1/gas`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: user.account.address }),
    });
    expect(again.status).toBe(409);
    const after = await (await fetch(`${API}/v1/wallet/${user.account.address}`)).json();
    expect(after.gasTopup.available).toBe(false);
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
